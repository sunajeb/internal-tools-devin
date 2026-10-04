# Network

Creates a virtual network, five subnets, subnet security groups, and private DNS zones.

## Key inputs

- `address_space` and each subnet prefix define network ranges.
- `runner_prefix` defines the deployment runner subnet.
- `name`, `location`, and `tags` identify and label the network.

## Outputs

Subnet IDs, private DNS zone IDs, DNS link IDs, and the virtual network ID.

## Important notes

The app integration and worker subnets use separate App Service delegations. Each App Service plan can integrate with one subnet.
The runner subnet enables the `Microsoft.Web` service endpoint for staging-slot access.
Run the approved apply job from a self-hosted runner in this subnet.
Requests from the runner subnet reach the staging slot directly. They do not go through the Front Door WAF or rate limit. Put only the approved apply runner in this subnet.
