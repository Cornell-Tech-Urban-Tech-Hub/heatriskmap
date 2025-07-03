from aws_cdk import (
    Stack,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_route53 as route53,
    aws_route53_targets as targets,
    aws_certificatemanager as acm,
    aws_s3_deployment as s3_deployment,
    RemovalPolicy,
    CfnOutput
)
from constructs import Construct

class HeatRiskMapS3Stack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Define the domain name and subdomain
        domain_name = "urbantech.info"
        subdomain = "heatmap"
        fqdn = f"{subdomain}.{domain_name}"

        # Look up the hosted zone
        zone = route53.HostedZone.from_lookup(self, "Zone", domain_name=domain_name)

        # Create a certificate for the subdomain
        certificate = acm.Certificate(self, "Certificate",
            domain_name=fqdn,
            validation=acm.CertificateValidation.from_dns(zone)
        )

        # Create S3 bucket for the static website
        website_bucket = s3.Bucket(self, "HeatRiskMapWebsiteBucket",
            bucket_name=f"{subdomain}.{domain_name}",
            public_read_access=False,  # CloudFront will access it via OAI
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            object_ownership=s3.ObjectOwnership.BUCKET_OWNER_ENFORCED
        )

        # Create CloudFront origin access identity
        origin_access_identity = cloudfront.OriginAccessIdentity(self, "OriginAccessIdentity",
            comment=f"OAI for {fqdn}")

        # Grant the OAI read access to the bucket
        website_bucket.grant_read(origin_access_identity)

        # Create CloudFront distribution using S3BucketOrigin with OAI
        distribution = cloudfront.Distribution(self, "HeatRiskMapDistribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_identity(
                    website_bucket,
                    origin_access_identity=origin_access_identity
                ),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
                origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cached_methods=cloudfront.CachedMethods.CACHE_GET_HEAD
            ),
            domain_names=[fqdn],
            certificate=certificate,
            default_root_object="index.html",
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=200,
                    response_page_path="/index.html"
                ),
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html"
                )
            ]
        )

        # Create Route53 A record pointing to CloudFront
        route53.ARecord(self, "AliasRecord",
            zone=zone,
            record_name=subdomain,
            target=route53.RecordTarget.from_alias(
                targets.CloudFrontTarget(distribution)
            )
        )

        # Deploy the static files from the container directory
        s3_deployment.BucketDeployment(self, "DeployWebsite",
            sources=[s3_deployment.Source.asset("./static/")],
            destination_bucket=website_bucket,
            distribution=distribution,
            distribution_paths=["/*"]
        )

        # Outputs
        CfnOutput(self, "WebsiteURL", value=f"https://{fqdn}")
        CfnOutput(self, "CloudFrontDistributionId", value=distribution.distribution_id)
        CfnOutput(self, "S3BucketName", value=website_bucket.bucket_name) 