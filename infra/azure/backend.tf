# backend.tf
#
# Configures WHERE Terraform stores its state file - not the infrastructure
# itself, just Terraform's own record-keeping of what it manages.
#
# Using an Azure Storage blob instead of a local .tfstate file means:
#   - state survives even if this laptop is lost/wiped
#   - state can eventually be shared safely across machines/team members
#     (not a concern solo, but this is the standard real-world pattern)
#   - Azure Storage handles state locking automatically, preventing two
#     "terraform apply" runs from corrupting state if run at the same time

terraform {
  required_version = ">= 1.15.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  backend "azurerm" {
    resource_group_name = "glaucoma-ai-tfstate-rg"
    storage_account_name = "glaucomaaitfstate2026"
    container_name       = "tfstate"
    key                   = "glaucoma-ai-azure.tfstate"
    # "key" is just the filename Terraform will write inside the container -
    # not a credential, just a name. Using a descriptive name in case more
    # state files (e.g. for other learning projects) share this same
    # storage account later.
  }
}

# The azurerm provider block itself - tells Terraform how to actually talk
# to Azure's API once state storage is configured above.
provider "azurerm" {
  features {}

  # subscription_id is set explicitly here rather than relying on whatever
  # "az account show" currently returns as default - this avoids a subtle
  # class of bug where Terraform silently targets the wrong subscription
  # if the active CLI subscription ever changes later.
  subscription_id = "d4a4e2c5-4f66-49e9-ae94-d140c3693703"
}
