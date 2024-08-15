from aws_cdk import (
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_elasticloadbalancingv2 as elbv2,
    Stack,
    Duration
)
from constructs import Construct

class DashStack(Stack):
    def __init__(self, scope: Construct, id: str, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)

        vpc = ec2.Vpc(
            self, "HeatDashStreamlitVPC",
            max_azs=2,
        )

        cluster = ecs.Cluster(self, "HeatDashStreamlitCluster", vpc=vpc)

        image = ecs.ContainerImage.from_asset('streamlit-docker')

        service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self, "HeatDashFargateService",
            cluster=cluster,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=image,
                container_port=8501,
                environment={
                    # Add any environment variables your app needs
                },
                log_driver=ecs.LogDrivers.aws_logs(stream_prefix="HeatDashStreamlit"),
            ),
            desired_count=2,
            cpu=4096,  # This corresponds to 4 vCPU
            memory_limit_mib=30720,  # This corresponds to 30 GB
            public_load_balancer=True,
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

        scaling = service.service.auto_scale_task_count(
            max_capacity=4
        )
        scaling.scale_on_cpu_utilization(
            "CpuScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.seconds(60),
            scale_out_cooldown=Duration.seconds(60),
        )