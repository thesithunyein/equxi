# Equxi Payout Agent

An Equxi feature for signed contractor payout approvals, one-time execution claims, and MultiHopper route receipts. Steve holds the signing authority and executes the route through the challenge integration.

## Run locally

Use Node 24 or later. Set the following variables in your shell or a private environment file outside the checkout.

| Variable | Value |
|---|---|
| `PAYOUT_OPERATOR_TOKEN` | Random secret, at least 32 characters. Used by the payout page. |
| `PAYOUT_AGENT_TOKEN` | Different random secret, at least 32 characters. Used by the MCP client. |
| `PAYOUT_AGENT_WALLET` | Registered Steve mainnet wallet address. |
| `PAYOUT_MINT` | One supported SPL token mint. |
| `PAYOUT_LIMIT_RAW` | Maximum token debit in the mint's base units. |
| `PAYOUT_RPC_URL` | Trusted Solana mainnet RPC URL used to verify finalized recipient credits. |
| `PAYOUT_DB` | SQLite location, ideally an absolute path on a persistent volume. Defaults to `payout.sqlite`. |
| `PAYOUT_ORIGIN` | Browser origin. Defaults to `http://localhost:4322`. |
| `PAYOUT_HOST` | Bind address. Defaults to `127.0.0.1`. |
| `PORT` | Port. Defaults to `4322`. |

Generate each token independently with `node -p "require('node:crypto').randomBytes(32).toString('hex')"`.

Run `npm ci`, then `npm run test:payout` and `npm run payout`. Open the configured origin. Create the payout and approve with the designated Phantom wallet. Approval signs the exact terms and expires after 24 hours.

## Connect Steve and route a payment

1. Run the service behind HTTPS on a host with persistent storage. Keep the database private and restrict operator-token access to the person administering and signing the payout. The static Equxi site does not host this service.
2. In Steve's MCP Workspace, connect the challenge's MultiHopper execution integration. Connect Equxi's `/mcp` endpoint as a Streamable HTTP MCP server using `Authorization: Bearer <PAYOUT_AGENT_TOKEN>`, if the workspace supports custom authorization headers. Verify all three tools appear before funding the agent. The public MultiHopper documentation MCP cannot sign or execute a route.
3. Confirm side-track funding rules, the qualifying amount, and route fees with the organizer before spending anything. Check that Steve exposes the quote details, including fees, and can enforce the signed payment constraints. Configure the Steve signer with the narrowest available recipient, asset, and spending permissions. If those controls or quote details are unavailable, keep real-money execution disabled.
4. Start one Steve run with the instruction below. The reviewer authorizes the payment in Equxi. Complete any separate signer confirmation Steve requires. Equxi's database claim is single-use, but it does not constrain transactions that Steve signs outside Equxi; the signer's mandate or explicit confirmation is the final enforcement point.
5. Refresh the receipt and click **Verify recipient credit** after reporting the final payment signature. Equxi verifies the exact net credit for the signed recipient and classic SPL mint in a successful finalized Solana mainnet transaction. Verify the MultiHopper route ID and registered agent wallet separately in Steve and MultiHopper, since the recipient credit alone does not establish route provenance. If execution times out, reconcile using Steve, MultiHopper, and Solana history. A claim never automatically resets.

### Steve run instruction

> Call Equxi `claim_payout` with payout ID **[ID]**. If the claim fails, stop. Get a MultiHopper quote for the exact mint, recipient and amount in the claim. Call Equxi `check_payout_quote` with the actual quote fields and stop on any error. Independently apply the configured Steve spending limits. Check any separate network fees against the Steve limits. Stop if any field or fee cannot be verified. Execute once using the Steve MultiHopper integration. Report the route ID and the final recipient-credit transaction signature with Equxi `record_route`. If execution is uncertain, stop and surface what is known. Do not start another route.

### Contest evidence

Use a genuine payment and capture the settled route evidence and the blocked duplicate claim. Publish the X post describing the workflow and tag @Multihopper, @OOBEonSol and @SteveCapitalOS. Submit the registered agent wallet, transaction evidence, and post link to the listing. Describe the launch as command-triggered if you started it with a Steve message. A human reconciliation step is required in this version.

[Superteam Earn listing](https://superteam.fun/earn/listing/build-an-autonomous-capital-agent-on-solana-and-compete-for-dollar500-in-rewards)
