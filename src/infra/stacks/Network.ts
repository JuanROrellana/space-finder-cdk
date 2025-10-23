import { Stack, StackProps } from 'aws-cdk-lib';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class NetworkStack extends Stack {
  public readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, 'SpaceFinderVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
            {
              cidrMask: 24,
              name: 'Public',
              subnetType: SubnetType.PUBLIC,
            },
            {
              cidrMask: 24,
              name: 'Private',
              subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            },
          ],
    });
  }
}
