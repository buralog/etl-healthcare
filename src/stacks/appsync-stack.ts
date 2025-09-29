import { Stack, StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';

export interface AppSyncStackProps extends StackProps {
  table: dynamodb.Table;          // required: DDB single-table
  userPool?: cognito.IUserPool;   // optional: reuse AuthStack pool if you pass it
}

export class AppSyncStack extends Stack {
  public readonly api: appsync.GraphqlApi;
  public readonly userPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props: AppSyncStackProps) {
    super(scope, id, props);

    // --- Cognito (reuse if provided, otherwise create)
    const userPool =
      props.userPool ??
      new cognito.UserPool(this, 'UserPool', {
        selfSignUpEnabled: false,
        signInAliases: { email: true },
        removalPolicy: RemovalPolicy.DESTROY, // dev
        customAttributes: {
          tenantId: new cognito.StringAttribute({ mutable: true }),
        },
      });

    const userPoolClient = userPool.addClient('UserPoolClient', {
      authFlows: { userPassword: true, adminUserPassword: true },
      preventUserExistenceErrors: true,
    });
    // Optional hosted domain when creating pool here
    if (!props.userPool) {
      const concretePool = userPool as cognito.UserPool;
      concretePool.addDomain('UserPoolDomain', {
        cognitoDomain: { domainPrefix: `${this.stackName.toLowerCase()}-etl` },
      });
      this.userPool = concretePool;
    } else {
      this.userPool = userPool as cognito.UserPool;
    }

    // --- AppSync API (schema next to repo’s src/appsync/schema.graphql)
    const schemaPath = path.join(process.cwd(), 'src', 'appsync', 'schema.graphql');

    this.api = new appsync.GraphqlApi(this, 'Api', {
      name: 'etl-healthcare',
      schema: appsync.SchemaFile.fromAsset(schemaPath),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
      },
      xrayEnabled: true,
    });

    // --- Lambda resolver (code from services/api-query/dist)
    const lambdaCodePath = path.join(process.cwd(), 'services', 'api-query', 'dist');

    const queryFn = new lambda.Function(this, 'QueryHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.main',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: props.table.tableName,
        GSI1_NAME: 'GSI1V2',
        GSI2_NAME: 'GSI2V2',
        TENANT_CLAIM: 'custom:tenantId', // matches Cognito custom attr
      },
    });
    props.table.grantReadData(queryFn);

    const ds = this.api.addLambdaDataSource('QueryDS', queryFn);

    // --- Field resolvers → single Lambda
    ds.createResolver('GetPatientResolver', {
      typeName: 'Query',
      fieldName: 'getPatient',
    });
    ds.createResolver('ObservationsByPatientResolver', {
      typeName: 'Query',
      fieldName: 'observationsByPatient',
    });
    ds.createResolver('LatestObservationResolver', {
      typeName: 'Query',
      fieldName: 'latestObservation',
    });

    // --- Outputs
    new CfnOutput(this, 'GraphQLEndpoint', { value: this.api.graphqlUrl });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
  }
}
