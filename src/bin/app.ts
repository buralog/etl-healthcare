import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../stacks/auth-stack';
import { DataStack } from '../stacks/data-stack';
import { StorageStack } from '../stacks/storage-stack';
import { MessagingStack } from '../stacks/messaging-stack';
import { AppSyncStack } from '../stacks/appsync-stack';
import { AlarmsStack } from '../stacks/alarms-stack';
import { IngestStack } from '../stacks/ingest-stack';
import { NormalizeStack } from '../stacks/normalize-stack';
import { PersistStack } from '../stacks/persist-stack';

const app = new cdk.App();

const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-central-1',
};

// Foundations
const auth = new AuthStack(app, 'EtL-Auth', { env });
const data = new DataStack(app, 'EtL-Data', { env });
const storage = new StorageStack(app, 'EtL-Storage', { env });
const messaging = new MessagingStack(app, 'EtL-Messaging', { env });

// Query API (single instance)
const appsync = new AppSyncStack(app, 'EtL-AppSync', {
    env,
    table: data.table, // cross-stack reference
    // If your AppSyncStack expects an existing User Pool, pass it here too:
    // userPool: auth.userPool,
});

// ETL stages (split)
const ingest = new IngestStack(app, 'EtL-Ingest', {
    env,
    rawBucket: storage.rawLanding,
    ingestQueue: messaging.ingestQueue,
});

const normalize = new NormalizeStack(app, 'EtL-Normalize', {
    env,
    ingestQueue: messaging.ingestQueue,
    normalizedQueue: messaging.normalizedQueue,
});

const persist = new PersistStack(app, 'EtL-Persist', {
    env,
    normalizedQueue: messaging.normalizedQueue,
    persistedQueue: messaging.persistedQueue,
    table: data.table,
});

// Alarms (point them at messaging/appsync/etc. inside the stack)
const alarms = new AlarmsStack(app, 'EtL-Alarms', { env });

// Optional explicit ordering (only if no props cross-reference)
ingest.addDependency(storage);
ingest.addDependency(messaging);

normalize.addDependency(messaging);

persist.addDependency(messaging);
persist.addDependency(data);

appsync.addDependency(data);
// If AppSyncStack consumes Auth resources via props, CDK will infer deps; if not, you can still declare:
appsync.addDependency(auth);

// Alarms usually depend on the things they watch:
alarms.addDependency(appsync);
alarms.addDependency(messaging);
alarms.addDependency(persist);
alarms.addDependency(data);
