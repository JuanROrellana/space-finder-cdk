# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AWS CDK project called "space-finder" that implements a serverless application for managing space entries. The application uses TypeScript and deploys infrastructure including API Gateway, Lambda functions, DynamoDB, Aurora PostgreSQL, VPC networking, and Cognito authentication.

## Build and Deploy Commands

```bash
# Install dependencies
npm install

# Synthesize CloudFormation template
npx cdk synth

# Deploy all stacks
npx cdk deploy --all

# Deploy specific stack
npx cdk deploy <StackName>

# View diff of changes
npx cdk diff

# Destroy all stacks
npx cdk destroy --all

# Bootstrap CDK (first time setup)
npx cdk bootstrap
```

## Architecture

### Stack Organization

The application is organized into multiple CDK stacks with explicit dependencies. The entry point is [src/infra/Launcher.ts](src/infra/Launcher.ts), which orchestrates all stack instantiation.

**Current Stacks:**
1. **NetworkStack-Primary** - Creates VPC with public/private subnets (2 AZs, 1 NAT gateway)
2. **DataStack-Primary** - Provisions DynamoDB table with streams and Aurora Serverless v2 PostgreSQL
3. **LambdaStack** - Deploys Lambda functions with proper IAM permissions
4. **ApiStack** - Sets up API Gateway with REST endpoints
5. **AuthStack** - Cognito User Pool for authentication (not currently integrated into Launcher.ts)

**Deployment Order:** NetworkStack → DataStack → LambdaStack → ApiStack

**Multi-Region Support:** The codebase contains commented-out infrastructure for Aurora Global Database with primary/secondary regions. Currently only primary region (us-west-2) is deployed.

### Stack Dependencies

- **DataStack** requires VPC from NetworkStack
- **LambdaStack** requires spacesTable, Aurora cluster, DB secret, and security group from DataStack; also requires VPC from NetworkStack
- **ApiStack** requires spacesLambdaIntegration from LambdaStack

### Lambda Functions

**spaces Lambda** ([src/services/spaces.ts](src/services/spaces.ts)):
- Handler for API Gateway requests
- Currently supports POST method only
- Uses AWS SDK DynamoDB client to interact with SpacesTable
- Entry point delegates to operation-specific handlers ([src/services/PostSpaces.ts](src/services/PostSpaces.ts))
- Runs outside VPC for better cold start performance

**sqlReplicator Lambda** ([src/services/sqlReplicator.ts](src/services/sqlReplicator.ts)):
- Triggered by DynamoDB Streams
- Runs in VPC (uses private subnets with NAT for outbound connectivity)
- Replicates DynamoDB changes to Aurora PostgreSQL using native `pg` library (NOT Prisma)
- Handles INSERT (inserts), MODIFY (upserts), and REMOVE (deletes) events
- Uses raw SQL with ON CONFLICT for upsert operations
- Targets `app.spaces` table in PostgreSQL

### Data Storage

**DynamoDB Table:**
- Table name: `SpacesTable-{suffix}` (suffix generated from stack ID)
- Partition key: `id` (STRING)
- Streams enabled: NEW_AND_OLD_IMAGES
- Data model defined in [src/services/model/Model.ts](src/services/model/Model.ts)
- No sort key or GSIs configured

**Aurora Serverless v2 PostgreSQL:**
- Database name: `spacefinder`
- Engine: PostgreSQL 16.6
- Single writer instance, no readers configured
- Credentials stored in AWS Secrets Manager (secret name: `SpaceFinder-Aurora-Secret`)
- Deployed in VPC private subnets with NAT for outbound access
- **No migration infrastructure currently exists** - schema must be managed manually
- Expected schema: `app.spaces` table with columns `id`, `name`, `location`, `capacity`, `created_at`, `updated_at`

**Aurora Global Database:** Infrastructure exists in code but is commented out. Can be enabled by uncommenting sections in DataStack.ts and Launcher.ts for multi-region replication.

### Authentication

**Cognito User Pool** ([src/infra/stacks/AuthStack.ts](src/infra/stacks/AuthStack.ts)):
- Self-signup enabled with email sign-in
- Supports multiple auth flows (SRP, USER_PASSWORD, ADMIN_USER_PASSWORD, CUSTOM)
- **Not currently integrated** - AuthStack exists but is not instantiated in Launcher.ts
- CloudFormation outputs: SpaceUserPoolId, SpaceUserPoolClientId

### Utilities

- **getSuffixFromStack()** ([src/infra/Utils.ts](src/infra/Utils.ts)): Generates unique suffix from CloudFormation stack ID for resource naming
- **Validator** ([src/services/shared/Validator.ts](src/services/shared/Validator.ts)): Validates SpaceEntry objects
- **Utils** ([src/services/shared/Utils.ts](src/services/shared/Utils.ts)): Contains createRandomId() and parseJSON() helpers

## Key Implementation Patterns

### Lambda Bundling
Uses `NodejsFunction` construct which automatically bundles TypeScript with esbuild. No separate build step needed for Lambda code.

### Database Schema Management
**Current state:** No migration framework. Database schema must be created manually before sqlReplicator can function.

**Expected schema:**
```sql
CREATE SCHEMA IF NOT EXISTS app;
CREATE TABLE app.spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  capacity INTEGER,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

**sqlReplicator implementation:** Uses `pg.Pool` for connection pooling and raw SQL queries. Upserts use PostgreSQL `ON CONFLICT` clause.

### Environment Variables
Lambda functions receive configuration via environment variables:
- **spaces Lambda**: `TABLE_NAME` (DynamoDB table name)
- **sqlReplicator Lambda**: `TABLE_NAME`, `DB_SECRET_ARN`, `DB_HOST`, `DB_PORT`, `DB_NAME`

### IAM Permissions
Lambda IAM policies are explicitly defined in LambdaStack using PolicyStatements:
- spaces Lambda: DynamoDB actions (PutItem, Scan, GetItem, UpdateItem, DeleteItem)
- sqlReplicator Lambda: Secrets Manager read access (via grantRead)

### VPC Configuration
- **NetworkStack** creates VPC with 2 AZs, public and private subnets, 1 NAT gateway
- **sqlReplicator** runs in VPC private subnets to access Aurora
- **spaces Lambda** runs outside VPC for better cold start performance

### Connection Management
sqlReplicator Lambda uses singleton `pg.Pool` pattern:
- Pool reused across warm Lambda invocations
- Connection limit: 5 per Lambda instance
- Database credentials fetched once from Secrets Manager and cached
- Timeouts: 30s idle, 10s connection timeout

### DynamoDB Streams Configuration
Event source mapping for sqlReplicator:
- Batch size: 1 (processes one record at a time)
- Starting position: LATEST
- Bisect batch on error: enabled
- Report batch item failures: enabled
- Max record age: 60 seconds
- Retry attempts: 1

## Testing

Test infrastructure stub located in [test/TestService.ts](test/TestService.ts). Current npm test script is placeholder.

## TypeScript Configuration

- Target: ES2020
- Module: CommonJS
- JSON module resolution enabled
- Compiler configured in [tsconfig.json](tsconfig.json)

## Common Development Tasks

### Enabling AuthStack
To integrate Cognito authentication:
1. Uncomment or add AuthStack instantiation in src/infra/Launcher.ts
2. Pass User Pool reference to ApiStack for authorizer configuration
3. Update API Gateway methods to use Cognito authorizer

### Enabling Multi-Region Aurora Global Database
To enable primary/secondary regions:
1. Uncomment secondary region stacks in src/infra/Launcher.ts
2. Uncomment global cluster configuration in src/infra/stacks/DataStack.ts
3. Uncomment secret replication configuration
4. Deploy primary region first, then secondary

### Setting Up Aurora Schema
Before deploying sqlReplicator:
1. Deploy NetworkStack and DataStack
2. Connect to Aurora via bastion host or VPC endpoint
3. Run schema creation SQL (see Database Schema Management section)
4. Deploy LambdaStack to enable replication
