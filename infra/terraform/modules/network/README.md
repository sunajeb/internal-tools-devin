# Network

Creates a virtual network, four delegated subnets, subnet security groups, and private DNS zones.

## Key inputs

- `address_space` and each subnet prefix define network ranges.
- `name`, `location`, and `tags` identify and label the network.

## Outputs

Subnet IDs, private DNS zone IDs, the PostgreSQL DNS link ID, and the virtual network ID.

## Important notes

The app integration and worker subnets use separate App Service delegations. Each App Service plan can integrate with one subnet.
