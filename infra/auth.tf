###############################################################################
#  ServiceSync Stage 3 Sign-In — Cognito User Pool
#  ==========================================================================
#  ⚠️  NOT APPLIED — REVIEW BEFORE `terraform apply`  ⚠️
#
#  This file is DESIGN SCAFFOLDING. It is intentionally NOT wired into any live
#  Terraform state, backend, or CI/CD deploy. Creating these resources has no
#  effect on the running dashboard (shared-password gate) or the extension
#  (self-declared advisor_id) until:
#    1. someone reviews this file,
#    2. it is added to a real Terraform workspace/state with a configured
#       provider + backend, and `terraform apply` is run deliberately, AND
#    3. the dashboard is deployed with AUTH_MODE=cognito + the pool outputs
#       exported as COGNITO_* env vars (see docs/AUTH_DESIGN.md).
#
#  There is deliberately NO `provider "aws"` and NO backend block here so that a
#  stray `terraform apply` in this directory cannot succeed by accident.
#
#  See docs/AUTH_DESIGN.md for the full design and migration plan.
###############################################################################

# --- Inputs -----------------------------------------------------------------
# Callback/logout URLs for the dashboard app client. Defaults target the live
# hostname; override per environment. Localhost is included for local testing.
variable "dashboard_callback_urls" {
  description = "Allowed OAuth callback URLs for the dashboard app client"
  type        = list(string)
  default = [
    "https://dashboard.servicesync.io/api/auth/callback",
    "http://localhost:3000/api/auth/callback",
  ]
}

variable "dashboard_logout_urls" {
  description = "Allowed sign-out redirect URLs for the dashboard app client"
  type        = list(string)
  default = [
    "https://dashboard.servicesync.io/login",
    "http://localhost:3000/login",
  ]
}

variable "hosted_ui_domain_prefix" {
  description = "Cognito Hosted UI domain prefix (must be globally unique)"
  type        = string
  default     = "servicesync-auth"
}

# --- User pool --------------------------------------------------------------
# One pool for all human users of the dashboard and, later, the extension.
# Sign-in with email; passwords enforced; MFA optional at pilot (tighten later).
resource "aws_cognito_user_pool" "servicesync_users" {
  name = "servicesync-users"

  # Users sign in with their email address.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Reasonable password policy for an internal-then-customer tool.
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # Optional MFA now; move to "ON" for owner/manager before broad rollout.
  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration {
    enabled = true
  }

  # Admin-created users at pilot scale (no open self-signup). Flip to allow
  # self-signup once we are customer-facing.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # The `role` custom attribute: advisor | manager | owner. Mutable so an
  # owner can promote/demote without recreating the user. Mirrored by groups
  # below for group-based policies + the cognito:groups claim.
  schema {
    name                     = "role"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 32
    }
  }

  # Stable ServiceSync advisor id (e.g. "siltaylor") mapped onto the identity,
  # so data prefixes/keys stay stable across the auth migration (see design §6).
  schema {
    name                     = "advisor_id"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  tags = {
    Project   = "ServiceSync"
    Component = "auth"
    Stage     = "stage3-signin"
    Managed   = "terraform-NOT-APPLIED"
  }
}

# --- Role groups (RBAC) -----------------------------------------------------
# Group membership mirrors custom:role. `precedence` lower = higher privilege,
# so the most-privileged group wins when a user is in several.
resource "aws_cognito_user_group" "owner" {
  name         = "owner"
  user_pool_id = aws_cognito_user_pool.servicesync_users.id
  description  = "Full access — founder / org admin"
  precedence   = 1
}

resource "aws_cognito_user_group" "manager" {
  name         = "manager"
  user_pool_id = aws_cognito_user_pool.servicesync_users.id
  description  = "Service manager — dealership-level visibility"
  precedence   = 10
}

resource "aws_cognito_user_group" "advisor" {
  name         = "advisor"
  user_pool_id = aws_cognito_user_pool.servicesync_users.id
  description  = "Service advisor — own data only"
  precedence   = 20
}

# --- Hosted UI domain -------------------------------------------------------
# Provides the managed login page + device-authorization verification page.
# Swap for a custom domain (auth.servicesync.io) + ACM cert before GA.
resource "aws_cognito_user_pool_domain" "hosted_ui" {
  domain       = var.hosted_ui_domain_prefix
  user_pool_id = aws_cognito_user_pool.servicesync_users.id
}

# --- App client: dashboard (web, Authorization Code + PKCE) -----------------
# No generated secret (PKCE public client pattern for a Next.js app that keeps
# tokens in httpOnly cookies). Enables refresh tokens for silent renewal.
resource "aws_cognito_user_pool_client" "dashboard" {
  name         = "servicesync-dashboard"
  user_pool_id = aws_cognito_user_pool.servicesync_users.id

  generate_secret = false

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = var.dashboard_callback_urls
  logout_urls   = var.dashboard_logout_urls

  # Also allow direct auth for the on-brand custom login (Option B in design).
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Short-lived access/id tokens, longer refresh — matches session design §5.
  access_token_validity  = 1  # hours
  id_token_validity      = 1  # hours
  refresh_token_validity = 30 # days
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Don't leak whether a username exists on failed login.
  prevent_user_existence_errors = "ENABLED"

  # The app must be able to read/write role + advisor_id on the profile.
  read_attributes  = ["email", "custom:role", "custom:advisor_id"]
  write_attributes = ["email", "custom:role", "custom:advisor_id"]
}

# --- App client: extension (headless, Device Grant + PKCE) ------------------
# Public client used by the capture agent to obtain a VERIFIED advisor identity
# via the OAuth 2.0 Device Authorization Grant (RFC 8628). Replaces the current
# self-declared advisor_id. See design §2.3.
resource "aws_cognito_user_pool_client" "extension" {
  name         = "servicesync-extension"
  user_pool_id = aws_cognito_user_pool.servicesync_users.id

  generate_secret = false

  # NOTE: the device-authorization grant is enabled at the Hosted UI /
  # user-pool level; the client just needs code flow + refresh for the polling
  # token exchange and silent renewal.
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "profile"]
  supported_identity_providers         = ["COGNITO"]

  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Headless client: short access token, long rotating refresh so the agent
  # rarely needs a fresh device authorization.
  access_token_validity  = 1   # hours
  id_token_validity      = 1   # hours
  refresh_token_validity = 90  # days
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}

# --- Outputs (export these as the dashboard's COGNITO_* env vars) -----------
output "user_pool_id" {
  description = "Set as COGNITO_USER_POOL_ID"
  value       = aws_cognito_user_pool.servicesync_users.id
}

output "dashboard_client_id" {
  description = "Set as COGNITO_CLIENT_ID (dashboard)"
  value       = aws_cognito_user_pool_client.dashboard.id
}

output "extension_client_id" {
  description = "Extension app client id (device grant)"
  value       = aws_cognito_user_pool_client.extension.id
}

output "hosted_ui_domain" {
  description = "Hosted UI base domain"
  value       = aws_cognito_user_pool_domain.hosted_ui.domain
}

output "issuer_url" {
  description = "JWT issuer / JWKS base — middleware validates against this"
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.servicesync_users.id}"
}

# Region is only referenced to build the issuer output. Requires the aws
# provider to be configured in the (not-yet-created) real workspace.
data "aws_region" "current" {}
