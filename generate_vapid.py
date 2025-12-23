"""
Generate VAPID keys for Web Push and print them. Run:
    python generate_vapid.py
Copy the public/private keys into your .env as:
    VAPID_PUBLIC_KEY=...
    VAPID_PRIVATE_KEY=...
Optional:
    VAPID_SUBJECT=mailto:you@example.com
"""
import base64
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def generate_vapid_keys():
    # P-256 curve per VAPID spec
    private_key = ec.generate_private_key(ec.SECP256R1())
    priv_num = private_key.private_numbers().private_value.to_bytes(32, "big")

    pub = private_key.public_key()
    pub_numbers = pub.public_numbers()
    x = pub_numbers.x.to_bytes(32, "big")
    y = pub_numbers.y.to_bytes(32, "big")
    pub_bytes = b"\x04" + x + y  # Uncompressed EC point

    return {
        "publicKey": b64url(pub_bytes),
        "privateKey": b64url(priv_num),
    }


def main():
    keys = generate_vapid_keys()
    pub = keys["publicKey"]
    priv = keys["privateKey"]
    print("VAPID_PUBLIC_KEY=", pub)
    print("VAPID_PRIVATE_KEY=", priv)
    print("\nAdd these to your .env:")
    print("VAPID_PUBLIC_KEY=", pub)
    print("VAPID_PRIVATE_KEY=", priv)
    print("VAPID_SUBJECT=mailto:you@example.com")


if __name__ == "__main__":
    main()
