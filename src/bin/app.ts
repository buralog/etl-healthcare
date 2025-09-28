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
import { AuditStack } from '../stacks/audit-stack';
import { ReprocessStack } from '../stacks/reprocess-stack';

const app = new cdk.App();

const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-central-1',
};

// ── Foundations
const auth = new AuthStack(app, 'EtL-Auth', { env });
const data = new DataStack(app, 'EtL-Data', { env });
const storage = new StorageStack(app, 'EtL-Storage', { env });
const messaging = new MessagingStack(app, 'EtL-Messaging', { env });

// ── Audit (shared function)
const audit = new AuditStack(app, 'EtL-Audit', {
    env,
    auditBucket: storage.auditBucket,
});

// ── ETL stages
const ingest = new IngestStack(app, 'EtL-Ingest', {
    env,
    rawBucket: storage.rawLanding,
    ingestQueue: messaging.ingestQueue,
    auditFn: audit.auditFn,
});

const normalize = new NormalizeStack(app, 'EtL-Normalize', {
    env,
    ingestQueue: messaging.ingestQueue,
    normalizedQueue: messaging.normalizedQueue,
    auditFn: audit.auditFn,
});

const persist = new PersistStack(app, 'EtL-Persist', {
    env,
    normalizedQueue: messaging.normalizedQueue,
    persistedQueue: messaging.persistedQueue,
    table: data.table,
    auditFn: audit.auditFn,
});

// ── Query API
const appsync = new AppSyncStack(app, 'EtL-AppSync', {
    env,
    table: data.table,
    // Pass userPool if you want to reuse Auth’s pool instead of creating a new one:
    // userPool: auth.userPool,
});

const reprocess = new ReprocessStack(app, 'EtL-Reprocess', {
  env,
  rawBucket: storage.rawLanding,
  ingestQueue: messaging.ingestQueue,
});

// ── Alarms (watch everything)
const alarms = new AlarmsStack(app, 'EtL-Alarms', { env });

// ── Explicit dependencies (only where not inferred by props):
audit.addDependency(storage);     // audit needs the audit bucket

ingest.addDependency(storage);
ingest.addDependency(messaging);

normalize.addDependency(messaging); // uses queues

persist.addDependency(data);
persist.addDependency(messaging);

appsync.addDependency(data);
appsync.addDependency(auth);       // if using Auth’s user pool (or keep even if not)


reprocess.addDependency(storage);
reprocess.addDependency(messaging);

// Alarms depend on resources they observe
alarms.addDependency(appsync);
alarms.addDependency(messaging);
alarms.addDependency(persist);
alarms.addDependency(data);
alarms.addDependency(storage);
alarms.addDependency(reprocess);
