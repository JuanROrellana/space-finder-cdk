import { App } from "aws-cdk-lib";
import { DataStack } from "../infra/stacks/DataStack";
import { LambdaStack } from "../infra/stacks/Lambda";
import { ApiStack } from "../infra/stacks/ApiStack";
import { NetworkStack } from "./stacks/Network";

const app = new App();

const account = process.env.CDK_DEFAULT_ACCOUNT!;
const primaryRegion = "us-east-1";
const secondaryRegion = "us-west-2";
const globalClusterId = "spacefinder-global-db";

// Primary region stacks
const networkPrimary = new NetworkStack(app, "NetworkStack-Primary", {
  env: { account, region: primaryRegion },
});
const dataPrimary = new DataStack(app, "DataStack-Primary", {
  env: { account, region: primaryRegion },
  vpc: networkPrimary.vpc,
  isGlobalPrimary: true,
  globalClusterId,
  secretReplicaRegions: [secondaryRegion],
});
const lambdaStack = new LambdaStack(app, "LambdaStack", {
  spacesTable: dataPrimary.spacesTable,
  vpc: networkPrimary.vpc,
  auroraCluster: dataPrimary.auroraCluster,
  dbSecret: dataPrimary.dbSecret,
  dbSecurityGroup: dataPrimary.dbSecurityGroup,
});
new ApiStack(app, "ApiStack", {
  spacesLambdaIntegration: lambdaStack.spacesLambdaIntegration,
});

// Secondary region stacks (read replica)
const networkSecondary = new NetworkStack(app, "NetworkStack-Secondary", {
  env: { account, region: secondaryRegion },
});
new DataStack(app, "DataStack-Secondary", {
  env: { account, region: secondaryRegion },
  vpc: networkSecondary.vpc,
  isGlobalPrimary: false,
  globalClusterId,
});
