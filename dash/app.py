#!/usr/bin/env python3
import os

import aws_cdk as cdk

from dash.s3_cloudfront_stack import HeatRiskMapS3Stack

app = cdk.App()

env=cdk.Environment(
    account=os.environ["CDK_DEFAULT_ACCOUNT"],
    region=os.environ["CDK_DEFAULT_REGION"])

HeatRiskMapS3Stack(
    app,
    "HeatDashJS-S3-CloudFront",
    description="Heat Dashboard using Javascript served from S3 with CloudFront",
    env=env
)

app.synth()
