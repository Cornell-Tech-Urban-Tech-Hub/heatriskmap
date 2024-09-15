#!/usr/bin/env python3
import os

import aws_cdk as cdk

from dash.dash_stack import DashStack

app = cdk.App()

env=cdk.Environment(
    account=os.environ["CDK_DEFAULT_ACCOUNT"],
    region=os.environ["CDK_DEFAULT_REGION"])

DashStack(
    app, 
    "HeatDashStreamlit-Production",
    description="Heat Dashboard using Streamlit, ECS Fargate, and CloudFront.",
    env=env
    )

app.synth()
