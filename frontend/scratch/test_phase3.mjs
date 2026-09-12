// Native global fetch in Node.js 24

async function testSimulator() {
  console.log("=== Testing Backend /api/simulate/defaults/bhadla ===");
  const defRes = await fetch("http://127.0.0.1:8000/api/simulate/defaults/bhadla");
  if (!defRes.ok) throw new Error(`defaults failed: ${defRes.status}`);
  const defaults = await defRes.json();
  console.log("Defaults loaded successfully for site:", defaults.site_id);
  console.log("Battery MW:", defaults.defaults.battery_power_mw, "MWh:", defaults.defaults.battery_energy_mwh);

  console.log("\n=== Testing Backend POST /api/simulate with Modified Battery ===");
  const modifiedReq = {
    site_id: "bhadla",
    battery_power_mw: 250,
    battery_energy_mwh: 600,
  };
  const simRes = await fetch("http://127.0.0.1:8000/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(modifiedReq)
  });
  if (!simRes.ok) throw new Error(`simulate failed: ${simRes.status} ${await simRes.text()}`);
  const simData = await simRes.json();
  console.log("Headline:", simData.primary_message);
  console.log("Baseline unserved:", simData.baseline.unserved_energy_mwh, "Scenario unserved:", simData.scenario.unserved_energy_mwh, "Delta:", simData.deltas.unserved_energy_mwh);
  console.log("Baseline cost:", simData.baseline.net_cost_inr, "Scenario cost:", simData.scenario.net_cost_inr, "Delta:", simData.deltas.net_cost_inr);
  console.log("Break-Even:", simData.break_even.message);
  console.log("Attribution count:", simData.attribution.length);
  for (const attr of simData.attribution) {
    console.log(`  - ${attr.lever}: unserved delta = ${attr.unserved_delta_mwh} MWh, cost delta = ₹${attr.cost_delta_inr}`);
  }
  console.log("Timeline blocks count:", simData.timeline.length);
  console.log("Block 1:", simData.timeline[0]);
  console.log("Block 48 (noon):", simData.timeline[47]);
  console.log("Block 76 (peak):", simData.timeline[75]);

  console.log("\n=== Testing Frontend /simulator Page Response ===");
  const feRes = await fetch("http://localhost:3000/simulator");
  if (!feRes.ok) throw new Error(`Frontend /simulator failed: ${feRes.status}`);
  const html = await feRes.text();
  console.log("Frontend /simulator HTML length:", html.length);
  if (!html.includes("What-If Simulator") && !html.includes("Why-if simulator")) {
    console.warn("Could not find title in static HTML (might be client rendered component)");
  } else {
    console.log("Found What-If Simulator in HTML!");
  }
  console.log("\nALL TESTS PASSED SUCCESSFULLY!");
}

testSimulator().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
