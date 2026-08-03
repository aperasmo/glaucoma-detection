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
