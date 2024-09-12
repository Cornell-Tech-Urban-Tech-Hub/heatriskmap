from aws_cdk import (
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_route53 as route53,
    aws_route53_targets as targets,
    aws_certificatemanager as acm,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    Stack,
    Duration,
    CfnOutput,
    RemovalPolicy
)
from constructs import Construct

class DashStack(Stack):
    def __init__(self, scope: Construct, id: str, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)

        # Define the domain name
        domain_name = "urbantech.info"
        subdomain = "heatmap-dev"
        fqdn = f"{subdomain}.{domain_name}"

        # Create VPC and ECS Cluster
        vpc = ec2.Vpc(self, "HeatDashStreamlitVPC", max_azs=2)
        cluster = ecs.Cluster(self, "HeatDashStreamlitCluster", vpc=vpc)

        # Load the Docker image
        image = ecs.ContainerImage.from_asset('streamlit-docker')

        # Look up the hosted zone
        hosted_zone = route53.HostedZone.from_lookup(self, "HostedZone", domain_name=domain_name)

        # Create a certificate
        certificate = acm.Certificate(self, "Certificate",
            domain_name=fqdn,
            validation=acm.CertificateValidation.from_dns(hosted_zone)
        )

        # Reference or create S3 bucket for heat risk data
        bucket_name = "heat-risk-dashboard"
        heat_risk_bucket = s3.Bucket.from_bucket_name(self, "HeatRiskBucket", bucket_name)


        # Create CloudFront distribution
        distribution = cloudfront.Distribution(self, "HeatRiskDistribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3Origin(heat_risk_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cached_methods=cloudfront.CachedMethods.CACHE_GET_HEAD
            ),
            certificate=certificate,
            domain_names=[fqdn]
        )

        # Create the Fargate service with ALB
        service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self, "HeatDashFargateService",
            cluster=cluster,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=image,
                container_port=8501,
                environment={
                    "CLOUDFRONT_URL": f"https://{distribution.distribution_domain_name}"
                },
                log_driver=ecs.LogDrivers.aws_logs(stream_prefix="HeatDashStreamlit"),
            ),
            desired_count=2,
            cpu=16384,
            memory_limit_mib=122880,
            public_load_balancer=True,
            certificate=certificate,
            domain_name=fqdn,
            domain_zone=hosted_zone,
        )

        # Configure the health check for the target group
        service.target_group.configure_health_check(
            path="/",
            healthy_http_codes="200",
            interval=Duration.seconds(60),
            timeout=Duration.seconds(30),
            healthy_threshold_count=3,
            unhealthy_threshold_count=3,
        )

        # Set up auto-scaling
        scaling = service.service.auto_scale_task_count(max_capacity=4)
        scaling.scale_on_cpu_utilization(
            "CpuScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.seconds(60),
            scale_out_cooldown=Duration.seconds(60),
        )

        # Output the DNS name of the load balancer
        CfnOutput(self, "LoadBalancerDNS", value=service.load_balancer.load_balancer_dns_name)

        # Output the CloudFront distribution URL
        CfnOutput(self, "CloudFrontURL", value=distribution.distribution_domain_name)