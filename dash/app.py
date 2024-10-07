#!/usr/bin/env python3
import os

import aws_cdk as cdk

from dash.dash_stack import HeatRiskMapAppStack

app = cdk.App()

env=cdk.Environment(
    account=os.environ["CDK_DEFAULT_ACCOUNT"],
    region=os.environ["CDK_DEFAULT_REGION"])

HeatRiskMapAppStack(
    app, 
    "HeatDashStreamlit-Production",
    description="Heat Dashboard using Javascript running on nginx and ECS Fargate",
    env=env
    )

app.synth()
