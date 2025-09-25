import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../stacks/auth-stack';
import { DataStack } from '../stacks/data-stack';
import { StorageStack } from '../stacks/storage-stack';
import { MessagingStack } from '../stacks/messaging-stack';
import { AppSyncStack } from '../stacks/appsync-stack';
import { EtlStack } from '../stacks/etl-stack';
import { AlarmsStack } from '../stacks/alarms-stack';
import { IngestStack } from "../stacks/ingest-stack";
import { NormalizeStack } from "../stacks/normalize-stack";
import { PersistStack } from "../stacks/persist-stack";

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


const ingest = new IngestStack(app, "EtL-Ingest", {
    env,
    rawBucket: storage.rawLanding,
    ingestQueue: messaging.ingestQueue,
});

ingest.addDependency(storage);
ingest.addDependency(messaging);


const normalize = new NormalizeStack(app, "EtL-Normalize", {
    env,
    ingestQueue: messaging.ingestQueue,
    normalizedQueue: messaging.normalizedQueue,
});

normalize.addDependency(messaging);

const persist = new PersistStack(app, "EtL-Persist", {
    env,
    normalizedQueue: messaging.normalizedQueue,
    persistedQueue: messaging.persistedQueue,
    table: data.table, // <-- expose `public readonly table: dynamodb.Table` in your DataStack if not already
});

persist.addDependency(messaging);
persist.addDependency(data);

