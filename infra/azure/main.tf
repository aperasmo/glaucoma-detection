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
# -----------------------------------------------------------------------
# Network Security Group (NSG)
# -----------------------------------------------------------------------
# Azure's equivalent of an AWS security group - but with one real
# structural difference worth knowing: on AWS, a security group attaches
# directly to the EC2 instance's network interface. On Azure, the NSG is
# a fully separate resource that must be explicitly ASSOCIATED with a
# subnet or network interface - it does nothing on its own just by
# existing in the same resource group. See the association resource
# below this block.
#
# Same five ports as the AWS security group, same reasoning for each:
#   22   - SSH (remote access + GitHub Actions CI/CD)
#   80   - HTTP (redirects to HTTPS via host Nginx)
#   443  - HTTPS (secure frontend and API)
#   8000 - FastAPI backend direct access
#   8081 - Go report service
resource "azurerm_network_security_group" "main" {
  name                = "glaucoma-ai-nsg"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  # Azure evaluates rules by "priority" - lower numbers are evaluated
  # first. Spacing these by 10 (100, 110, 120...) leaves room to insert
  # a new rule later without renumbering everything else.

  security_rule {
    name                       = "SSH"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTP"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTPS"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "Backend"
    priority                   = 130
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8000"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "ReportService"
    priority                   = 140
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8081"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

# The explicit association step mentioned above - this is what actually
# makes the NSG rules apply to traffic reaching the subnet. Without this
# resource, the NSG would exist in Azure but do absolutely nothing.
resource "azurerm_subnet_network_security_group_association" "main" {
  subnet_id                 = azurerm_subnet.main.id
  network_security_group_id = azurerm_network_security_group.main.id
}