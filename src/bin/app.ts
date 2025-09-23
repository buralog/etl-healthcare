import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../stacks/auth-stack';
import { DataStack } from '../stacks/data-stack';
import { StorageStack } from '../stacks/storage-stack';
import { MessagingStack } from '../stacks/messaging-stack';
import { AppSyncStack } from '../stacks/appsync-stack';
import { EtlStack } from '../stacks/etl-stack';
import { AlarmsStack } from '../stacks/alarms-stack';

const app = new cdk.App();

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION || 'eu-central-1' };

const auth = new AuthStack(app, 'EtL-Auth', { env });
const data = new DataStack(app, 'EtL-Data', { env });
const storage = new StorageStack(app, 'EtL-Storage', { env });
const messaging = new MessagingStack(app, 'EtL-Messaging', { env });
const appsync = new AppSyncStack(app, 'EtL-AppSync', { env });
const etl = new EtlStack(app, 'EtL-ETL', { env });
const alarms = new AlarmsStack(app, 'EtL-Alarms', { env });

etl.addDependency(storage);
etl.addDependency(messaging);
appsync.addDependency(data);
alarms.addDependency(etl);
