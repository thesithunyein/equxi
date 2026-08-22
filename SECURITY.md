# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Equxi, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email: **sithunyein.mailto@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 1 week
- **Fix timeline:** depends on severity

## Scope

This security policy applies to:
- The Equxi Anchor program (`programs/equxi/`)
- The TypeScript SDK (`sdk/`)
- The web dashboard (`app.js`)

## Out of Scope

- Phantom wallet vulnerabilities (report to Phantom)
- Solana runtime issues (report to Solana)
- Third-party dependencies

## Bug Bounty

Currently no bug bounty program. If you find a critical vulnerability that could lead to fund loss, contact us directly. We will acknowledge your contribution.

## Best Practices for Users

- Never share your private keys or seed phrase
- Verify transaction details in Phantom before signing
- Use a dedicated wallet for testing on devnet
- Check the program ID matches `D7akK6aUVdYWfSwRDtuKFExZQkqtWZ1EFrRz1LQdfvhc` before interacting
