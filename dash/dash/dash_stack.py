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

        task_definition = ecs.FargateTaskDefinition(
            self, "TaskDef",
            cpu=1024,
            memory_limit_mib=2048,
        )

        container = task_definition.add_container(
            "StreamlitContainer",
            image=image,
            logging=ecs.LogDrivers.aws_logs(stream_prefix="HeatDashStreamlit"),
            health_check=ecs.HealthCheck(
                command=["CMD-SHELL", "curl -f http://localhost:8501/ || exit 1"],
                interval=Duration.seconds(30),
                timeout=Duration.seconds(5),
                retries=3,
                start_period=Duration.seconds(60),
            )
        )

        container.add_port_mappings(ecs.PortMapping(container_port=8501))

        service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self, "HeatDashFargateService",
            cluster=cluster,
            cpu=1024,
            desired_count=2,
            task_definition=task_definition,
            memory_limit_mib=2048,
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