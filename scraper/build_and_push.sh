#!/bin/bash
# build_and_push.sh

# Get Terraform outputs with error handling
REGION=$(terraform output -raw region 2>/dev/null || echo "us-east-1")
REPO_URL=$(terraform output -raw ecr_repository_url 2>/dev/null || echo "870747888580.dkr.ecr.us-east-1.amazonaws.com/batch-repo")

echo "Using region: $REGION"
echo "Using repository URL: $REPO_URL"

# Login to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REPO_URL

# Build the image
docker build -t $REPO_URL:latest ./build

# Push the image
docker push $REPO_URL:latest