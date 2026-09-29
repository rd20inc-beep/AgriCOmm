const fs = require('fs');
const path = require('path');

// total_bags is the count that ARRIVED and is never decremented — milling
// consumes the rice, not the row. A fully milled lot therefore carried its 1,000
// katta into a stock report that showed 0 kg on hand.
//
// The rule, restated here so it is testable independently of the controller.
const kattaOnHand = (l, onHandKg) => {
  const intake = l.total_bags == null ? null : Number(l.total_bags);
  const received = parseFloat(l.received_net_weight_kg) || 0;
  if (intake != null && intake > 0 && received > 0) {
    return Math.min(intake, Math.round(intake * (onHandKg / received)));
  }
  const per = parseFloat(l.bag_weight_kg) || parseFloat(l.bag_size_kg) || 50;
  return per > 0 ? Math.round(onHandKg / per) : 0;
};

describe('katta on hand', () => {
  test('a fully milled lot has none left — the reported bug', () => {
    // SHAP-1121BASM-260926-01: 1,000 katta in, 49,857 kg received, fully consumed.
    expect(kattaOnHand({ total_bags: 1000, received_net_weight_kg: 49857 }, 0)).toBe(0);
  });

  test('an untouched lot keeps its counted sacks exactly', () => {
    expect(kattaOnHand({ total_bags: 530, received_net_weight_kg: 26495 }, 26495)).toBe(530);
  });

  test('a partly consumed lot scales down', () => {
    // 26,495 kg in 530 katta, 22,995 left.
    expect(kattaOnHand({ total_bags: 530, received_net_weight_kg: 26495 }, 22995)).toBe(460);
    // 72,450 kg in 1,449 katta, 48,450 left.
    expect(kattaOnHand({ total_bags: 1449, received_net_weight_kg: 72450 }, 48450)).toBe(969);
  });

  test('it never reports more sacks than arrived', () => {
    // A lot that gained weight (a top-up recorded against it) must not invent
    // sacks that were never counted.
    expect(kattaOnHand({ total_bags: 100, received_net_weight_kg: 5000 }, 9000)).toBe(100);
  });

  test('the counted sacks are scaled, NOT recomputed from a nominal size', () => {
    // Part-filled sacks are real: 400 katta holding 16,000 kg is 40 kg each, and
    // an untouched lot must still report 400, not 16,000 / 50 = 320.
    expect(kattaOnHand({ total_bags: 400, received_net_weight_kg: 16000, bag_weight_kg: 50 }, 16000)).toBe(400);
  });

  test('with no intake count it falls back to the per-bag weight', () => {
    // M-002-FIN-01 has no bag count at all.
    expect(kattaOnHand({ total_bags: null, received_net_weight_kg: 24000, bag_weight_kg: 50 }, 24000)).toBe(480);
    expect(kattaOnHand({ total_bags: 0, received_net_weight_kg: 0, bag_size_kg: 25 }, 400)).toBe(16);
  });

  test('no figures at all falls back to 50 kg rather than dividing by zero', () => {
    expect(kattaOnHand({ total_bags: null, received_net_weight_kg: 0 }, 500)).toBe(10);
    expect(kattaOnHand({ total_bags: null, received_net_weight_kg: 0 }, 0)).toBe(0);
  });
});

describe('the stock report uses it', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/analytics/reporting.controller.js'), 'utf8',
  );

  test('the katta column is derived, not the raw intake count', () => {
    // The derived count now also splits katta from sub-50 kg bags, so it is
    // held in `units` and only the sacks land in `bags`.
    expect(src).toContain('const units = kattaOnHand(l, onHand);');
    expect(src).toContain('bags: isKatta ? units : 0,');
    expect(src).not.toContain('status: l.status, bags: l.total_bags,');
  });

  test('the intake count is still available, under its own name', () => {
    expect(src).toContain('intakeBags: l.total_bags,');
  });

  test('the query selects what the rule needs', () => {
    expect(src).toContain("'l.received_net_weight_kg'");
    expect(src).toContain("'l.bag_weight_kg'");
  });
});
