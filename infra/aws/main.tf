# main.tf
#
# infra/aws - deliberately separate from infra/azure. This folder exists
# purely to DESCRIBE infrastructure that already exists in AWS - not to
# create anything new. Every resource block written here will be created
# by "terraform import" (a read-only linking operation), never by
# "terraform apply", until every single resource shows zero drift under
# "terraform plan".
#
# No backend block below - unlike infra/azure, this deliberately uses
# LOCAL state (a terraform.tfstate file sitting in this folder, already
# excluded from git). Setting up remote state (S3) would itself require
# an apply, which we are avoiding entirely for this phase of work.

terraform {
  required_version = ">= 1.15.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
  # Credentials are read from the same AWS CLI configuration already
  # used earlier in this project (the EC2 resize to t3.xlarge for the
  # conference) - no separate auth setup needed here.
}

# The default VPC - referenced, not created. AWS auto-provisions one
# default VPC per region; EC2 launched into it without any explicit
# networking setup ever being done. This is a DATA SOURCE, not a
# resource - Terraform will never try to create, modify, or destroy
# this, only read its existing ID for other resources to reference.
data "aws_vpc" "default" {
  default = true
}
