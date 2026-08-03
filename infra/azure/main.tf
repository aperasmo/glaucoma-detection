# main.tf
#
# This is the actual infrastructure Terraform will manage going forward -
# separate from backend.tf, which only configures WHERE state is stored.
#
# Resources are added here incrementally, one working piece at a time:
# resource group first, then networking, then the VM itself. Each addition
# gets its own "terraform plan" review before "terraform apply", so you see
# exactly what Terraform intends to change before it touches anything real.

# The container for every other resource in this learning project.
# Deliberately separate from glaucoma-ai-tfstate-rg (state storage) - this
# one is for the actual VM/networking infrastructure, so the two concerns
# stay cleanly separated and either could be destroyed independently later
# without affecting the other.
resource "azurerm_resource_group" "main" {
  name     = "glaucoma-ai-learning-rg"
  location = "australiaeast"

  tags = {
    project = "glaucoma-ai-terraform-learning"
    purpose = "personal learning - not production"
  }
}
# -----------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------
# AWS gave you a "default VPC" automatically in every region - you never
# had to define one for the EC2 instance. Azure has no equivalent implicit
# network. Everything below is explicit, on purpose.

resource "azurerm_virtual_network" "main" {
  name                = "glaucoma-ai-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_subnet" "main" {
  name                 = "glaucoma-ai-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}