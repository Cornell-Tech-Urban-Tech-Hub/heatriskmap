from aws_cdk import (
    Stack,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_route53 as route53,
    aws_certificatemanager as acm,
    aws_cloudwatch as cloudwatch,
    aws_s3 as s3,
    aws_logs as logs,
    Duration,
    CfnOutput,
    RemovalPolicy
)
from constructs import Construct

class HeatRiskMapAppStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Define the domain name and subdomain
        domain_name = "urbantech.info"
        subdomain = "heatmap"
        fqdn = f"{subdomain}.{domain_name}"

        # VPC
        vpc = ec2.Vpc(self, "HeatRiskMapAppVpc", max_azs=2)

        # ECS Cluster with Container Insights enabled
        cluster = ecs.Cluster(self, "HeatRiskMapAppCluster", 
            vpc=vpc,
            container_insights=True
        )

        # Look up the hosted zone
        zone = route53.HostedZone.from_lookup(self, "Zone", domain_name=domain_name)

        # Create a certificate for the subdomain
        certificate = acm.Certificate(self, "Certificate",
            domain_name=fqdn,
            validation=acm.CertificateValidation.from_dns(zone)
        )

        # Reference existing S3 bucket
        bucket_name = "heat-risk-dashboard"
        existing_bucket = s3.Bucket.from_bucket_name(self, "ExistingBucket", bucket_name)

        # Create a log group for the Fargate service
        log_group = logs.LogGroup(self, "HeatRiskMapAppLogGroup",
            log_group_name="/ecs/heatriskmap",
            removal_policy=RemovalPolicy.DESTROY,
            retention=logs.RetentionDays.ONE_WEEK
        )

        # Fargate Service
        fargate_service = ecs_patterns.ApplicationLoadBalancedFargateService(self, "HeatRiskMapAppService",
            cluster=cluster,
            cpu=256,
            memory_limit_mib=512,
            desired_count=2,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_asset("./container/"),
                container_port=80,
                environment={
                    "S3_BUCKET_NAME": bucket_name
                },
                log_driver=ecs.LogDrivers.aws_logs(
                    stream_prefix="HeatRiskMapApp",
                    log_group=log_group
                ),
            ),
            certificate=certificate,
            domain_name=fqdn,
            domain_zone=zone,
        )

        # Configure health check for the target group
        fargate_service.target_group.configure_health_check(
            path="/",
            healthy_http_codes="200",
            interval=Duration.seconds(30),
            timeout=Duration.seconds(10),
            healthy_threshold_count=2,
            unhealthy_threshold_count=2,
        )

        # Set up auto-scaling
        scaling = fargate_service.service.auto_scale_task_count(max_capacity=4)
        scaling.scale_on_cpu_utilization(
            "CpuScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.seconds(60),
            scale_out_cooldown=Duration.seconds(60),
        )

        # CloudWatch Dashboard
        dashboard = cloudwatch.Dashboard(self, "HeatRiskMapAppDashboard",
            dashboard_name="HeatRiskMapAppMetrics"
        )

        # Add metrics to the dashboard
        dashboard.add_widgets(
            cloudwatch.GraphWidget(
                title="Request Count",
                left=[fargate_service.load_balancer.metrics.request_count()]
            ),
            cloudwatch.GraphWidget(
                title="CPU Utilization",
                left=[fargate_service.service.metric_cpu_utilization()]
            ),
            cloudwatch.GraphWidget(
                title="Memory Utilization",
                left=[fargate_service.service.metric_memory_utilization()]
            ),
            cloudwatch.LogQueryWidget(
                title="Application Logs",
                log_group_names=[log_group.log_group_name],
                query_lines=[
                    "fields @timestamp, @message",
                    "sort @timestamp desc",
                    "limit 100"
                ],
                width=24
            )
        )

        # Create CloudWatch alarms
        cpu_alarm = cloudwatch.Alarm(self, "CPUUtilizationAlarm",
            metric=fargate_service.service.metric_cpu_utilization(),
            threshold=70,
            evaluation_periods=3,
            datapoints_to_alarm=2,
        )

        memory_alarm = cloudwatch.Alarm(self, "MemoryUtilizationAlarm",
            metric=fargate_service.service.metric_memory_utilization(),
            threshold=70,
            evaluation_periods=3,
            datapoints_to_alarm=2,
        )

        # Add alarms to dashboard
        dashboard.add_widgets(
            cloudwatch.AlarmWidget(
                title="CPU Utilization Alarm",
                alarm=cpu_alarm
            ),
            cloudwatch.AlarmWidget(
                title="Memory Utilization Alarm",
                alarm=memory_alarm
            )
        )

        # Outputs
        CfnOutput(self, "LoadBalancerDNS", value=fargate_service.load_balancer.load_balancer_dns_name)
        CfnOutput(self, "DashboardURL", 
                  value=f"https://{self.region}.console.aws.amazon.com/cloudwatch/home?region={self.region}#dashboards:name=HeatRiskMapAppMetrics")