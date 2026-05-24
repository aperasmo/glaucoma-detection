# backend/app/utils/security.py
#
# Security utilities for password hashing and verification.
# Uses bcrypt via passlib - industry standard for password hashing.
# Passwords are never stored or logged as plain text anywhere.

from passlib.context import CryptContext

# CryptContext tells passlib to use bcrypt as the hashing algorithm.
# bcrypt is slow by design - makes brute force attacks expensive.
# deprecated="auto" means old hashes are automatically upgraded on next login.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain_password: str) -> str:
    # Hash a plain text password and return the bcrypt hash.
    # Call this before saving any password to the database.
    return pwd_context.hash(plain_password)

def verify_password(plain_password: str, hash_password: str) -> bool:
    # Compare a plain text password against a stored bcrypt hash.
    # Returns True if they match, False otherwise.
    # Call this during login to validate credentials.
     return pwd_context.verify(plain_password,hash_password)