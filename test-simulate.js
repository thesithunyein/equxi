// Test: simulate transaction on devnet to get exact error
const RPC = "https://api.devnet.solana.com";

async function simulateTx() {
  // Build a minimal initialize+register tx and simulate
  // We'll use a dummy keypair for testing
  const enc = new TextEncoder();

  // Compute discriminators using pure JS SHA-256
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function rr(x,n){return(x>>>n)|(x<<(32-n));}
  function sha256(message) {
    let msg = new Uint8Array(message);
    const bitLen = msg.length * 8;
    msg = new Uint8Array([...msg, 0x80, ...new Uint8Array((55 - msg.length % 64 + 64) % 64)]);
    new DataView(msg.buffer).setBigUint64(msg.length - 8, BigInt(bitLen));
    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    for (let i = 0; i < msg.length; i += 64) {
      const W = new Array(64);
      for (let j = 0; j < 16; j++) W[j] = (msg[i+j*4]<<24)|(msg[i+j*4+1]<<16)|(msg[i+j*4+2]<<8)|msg[i+j*4+3];
      for (let j = 16; j < 64; j++) {
        const s0 = rr(W[j-15],7)^rr(W[j-15],18)^(W[j-15]>>>3);
        const s1 = rr(W[j-2],17)^rr(W[j-2],19)^(W[j-2]>>>10);
        W[j] = (W[j-16]+s0+W[j-7]+s1)|0;
      }
      let [a,b,c,d,e,f,g,h] = H;
      for (let j = 0; j < 64; j++) {
        const s1 = rr(e,6)^rr(e,11)^rr(e,25);
        const ch = (e&f)^(~e&g);
        const t1 = (h+s1+ch+K[j]+W[j])|0;
        const s0 = rr(a,2)^rr(a,13)^rr(a,22);
        const mj = (a&b)^(a&c)^(b&c);
        const t2 = (s0+mj)|0;
        h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
      }
      H = [(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i*4]=(H[i]>>>24)&0xff;out[i*4+1]=(H[i]>>>16)&0xff;out[i*4+2]=(H[i]>>>8)&0xff;out[i*4+3]=H[i]&0xff;
    }
    return out;
  }

  function disc(name) {
    return sha256(enc.encode("global:" + name)).slice(0, 8);
  }

  const initD = disc("initialize");
  const regD = disc("register_agent");
  const bondD = disc("create_bond");
  const constD = disc("add_constraint");

  console.log("Discriminators:");
  console.log("  initialize:", Buffer.from(initD).toString('hex'));
  console.log("  register_agent:", Buffer.from(regD).toString('hex'));
  console.log("  create_bond:", Buffer.from(bondD).toString('hex'));
  console.log("  add_constraint:", Buffer.from(constD).toString('hex'));
  console.log("  Agent account:", Buffer.from(sha256(enc.encode("account:Agent"))).slice(0,8).toString('hex'));
  console.log("  Config account:", Buffer.from(sha256(enc.encode("account:Config"))).slice(0,8).toString('hex'));
  console.log("  Bond account:", Buffer.from(sha256(enc.encode("account:Bond"))).slice(0,8).toString('hex'));
  console.log("  Constraint account:", Buffer.from(sha256(enc.encode("account:Constraint"))).slice(0,8).toString('hex'));
}

simulateTx().catch(console.error);
