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
# -----------------------------------------------------------------------
# Public IP
# -----------------------------------------------------------------------
# Equivalent to your AWS Elastic IP - a static public address that stays
# the same even if the VM is stopped and restarted. Without "Static"
# allocation, Azure would assign a new IP every time the VM restarts,
# the exact problem the Elastic IP solved on the AWS side.
#
# sku = "Standard" is mandatory, not a preference - Azure fully retired
# the older "Basic" SKU on 30 September 2025, and new Basic public IPs
# haven't been creatable since March 2025. Standard also brings a real
# security-by-default behaviour worth knowing: inbound traffic is denied
# unless explicitly allowed by an NSG - which lines up exactly with the
# NSG rules already defined above.
resource "azurerm_public_ip" "main" {
  name                = "glaucoma-ai-public-ip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

# -----------------------------------------------------------------------
# Network Interface
# -----------------------------------------------------------------------
# The one genuinely new concept without a direct AWS equivalent to think
# about explicitly. On AWS, EC2 instance launch handles the network
# connection mostly implicitly - pick a subnet and security group, AWS
# wires the rest up behind the scenes. On Azure, that connection is its
# own resource, sitting between the VM and everything else: the subnet
# it lives inside, and the public IP it's reachable at. The VM, created
# next, will reference THIS resource - not the subnet or public IP
# directly.
resource "azurerm_network_interface" "main" {
  name                = "glaucoma-ai-nic"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.main.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.main.id
  }
}

# -----------------------------------------------------------------------
# Virtual Machine
# -----------------------------------------------------------------------
# The actual compute instance - everything before this point was
# supporting infrastructure that didn't run anything by itself.
#
# Notice this references azurerm_network_interface.main, not the subnet
# or public IP directly - matching what the network interface section
# above explained. The VM has no direct awareness of the subnet or
# public IP; it only knows about the network interface, which in turn
# knows about both of those.
resource "azurerm_linux_virtual_machine" "main" {
  name                = "glaucoma-ai-azure-vm"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  # Standard_B2s (x64) hit a real capacity restriction in australiaeast
  # for this subscription - "SkuNotAvailable" on first apply attempt.
  # Standard_B2ps_v2 is the ARM64-based equivalent (2 vCPU, burstable
  # B-series) and was confirmed available with no restrictions via
  # `az vm list-skus`. Not a mistake or workaround - deliberately fine
  # for a learning project where matching AWS's exact x64 architecture
  # isn't the point of the exercise.
  size = "Standard_B2ps_v2"

  # Azure has no equivalent of AWS's preset "ubuntu" user baked into the
  # image. Whatever username is specified here is the one Azure actually
  # creates on first boot - "azureuser" is the standard Azure convention,
  # used throughout Microsoft's own docs and tooling, though it means
  # your SSH command will look different from the AWS side's "ubuntu@...".
  admin_username = "azureuser"

  network_interface_ids = [
    azurerm_network_interface.main.id
  ]

  # Password login is disabled entirely - SSH key only, matching the
  # AWS side's security posture with glaucoma-ai-key.pem.
  disable_password_authentication = true

  admin_ssh_key {
    username   = "azureuser"
    public_key = file("~/glaucoma-ai-azure-key.pub")
  }

  # StandardSSD_LRS rather than the cheaper Standard_LRS - the plain
  # Standard tier is HDD-backed and noticeably sluggish for OS boot/IO,
  # enough to make the VM genuinely unpleasant to use for what amounts
  # to a small cost difference. Worth the small extra spend for a VM
  # you're going to actually SSH into and work on.
  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
  }

  # Azure enables "Trusted Launch" (secure boot + vTPM) by default on new
  # VMs - but ARM64 images explicitly do not support Trusted Launch and
  # must use the "Standard" security type instead. Confirmed via current
  # Ubuntu-on-Azure documentation. Leaving these at their true defaults
  # would fail the apply a second time, for a different reason than the
  # capacity error above.
  secure_boot_enabled = false
  vtpm_enabled         = false

  # sku confirmed directly via `az vm image list-skus` rather than
  # assumed by pattern from older Ubuntu versions - Canonical's naming
  # here turned out simpler than 20.04/22.04's convention: just
  # "server" (x64) vs "server-arm64" (this), with the version already
  # captured in the offer name itself.
  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server-arm64"
    version   = "latest"
  }

  tags = {
    project = "glaucoma-ai-terraform-learning"
    purpose = "personal learning - not production"
  }
}