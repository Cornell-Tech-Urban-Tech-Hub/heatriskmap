# NWS Heat Risk x CDC Heat and Health Index Dashboard

## Description

This application is an experimental dashboard that combines two new indices published by federal agencies to help understand the health impacts of extreme heat — the NWS Heat Risk and the CDC Heat and Health Index.

It consists of two parts:

- A Python **scraper** script that is deployed to AWS with Terraform, and runs an AWS Batch job nightly to fetch and preprocess data from the NWS and CDC.
- A JavaScript web **dashboard** app that is deployed as a static site to AWS S3 and served via CloudFront using AWS CDK.

## `dash`

A static JavaScript app (in the `static` directory) that allows users to make selections of day and indicator, and thresholds for filters for both.

### Development

To run locally, simply open the `index.html` file in the `static` directory in your browser:

    cd dash/static
    open index.html

Or use a simple HTTP server (recommended for local development):

    cd dash/static
    python3 -m http.server

Then load the app at [http://127.0.0.1:8000/](http://127.0.0.1:8000/)

### Deployment

Deployed as a static website to AWS S3 and served via CloudFront using AWS CDK. The static assets are located in the `static` directory.

To update the stack:

    cd dash
    cdk synth # check the stack
    cdk deploy # push changes

This will upload the contents of the `static` directory to the S3 bucket and update the CloudFront distribution.

### Load Testing

We use locust for load testing the deployed app.

    cd dash/dash
    locust -f load-test.py --host=https://heatmap.urbantech.info

Then open the [Locust dashboard](http://0.0.0.0:8089/) locally and configure and run your load test.

Monitor performance on the [Cloudwatch Dashboard](https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/HeatDashStreamlitDashboard?start=PT1H&end=null).

## `scraper`

A containerized Batch script deployed to AWS with Terraform runs once nightly to fetch and preprocess and join the NWS and CDC data layers. One geoparquet is produced for each of the 7 days of the NWS Heat Risk forecast with area-weighted indicators joined from the CDC Heat and Health Index data (which is the same for all days). These data are stored in a public S3 bucket.

Goal is to create Lambda function packaged for deployment as an AWS CDK stack, and have it run 1x daily to download and combine all the files into 7 geoparquets, one for each day, saved to a public S3 bucket and accessible using the following filename template `https://heat-risk-dashboard.s3.amazonaws.com/heat_risk_analysis_Day+1_20240801.geoparquet` where YYYYMMDD string is the date of the NWS Heat Risk forecast and Day+n is which day in the forecast the file represents.

### Development

1. Test it locally:
        
        cd ./scraper/build
        
        docker build -t urbantech/heat-risk-scraper:latest .
        
        docker run -it urbantech/heat-risk-scraper:latest # saving to S3 will fail

### Deployment

2. Build and push the docker image

        ./build_and_push.sh

3. Deploy/update the stack with Terraform

        terraform apply

4. Manually test the AWS Batch job (fastest to do in the AWS web console but can also use CLI)

        aws sso login
        
        aws batch submit-job \
                --job-name ManualTrigger-$(date +%Y%m%d-%H%M%S) \
                --job-queue <your-job-queue-arn> \
                --job-definition <your-job-definition-arn>

        aws batch describe-jobs --jobs <your-job-id>

## `notebooks`

Miscellaneous Jupyter notebooks for prototyping and debugging of data pipelines and map. 