const db = require('../src/config/database');
const auditService = require('../src/services/auditService');

async function run() {
  const accountId = parseInt(process.env.BANK_ACCOUNT_ID || '1', 10);
  const auditUserId = parseInt(process.env.AUDIT_USER_ID || '1', 10);

  if (!accountId || Number.isNaN(accountId)) {
    throw new Error('BANK_ACCOUNT_ID must be a valid number');
  }

  const account = await db('bank_accounts').where({ id: accountId }).first();
  if (!account) {
    throw new Error(`Bank account ${accountId} not found`);
  }

  const currentBalance = parseFloat(account.current_balance) || 0;
  if (currentBalance >= 0) {
    console.log(`Bank account ${accountId} is already non-negative (${currentBalance.toFixed(2)}). No change made.`);
    return { changed: false, accountId, currentBalance };
  }

  await db.transaction(async (trx) => {
    await trx('bank_accounts')
      .where({ id: accountId })
      .update({
        current_balance: 0,
        updated_at: trx.fn.now(),
      });

    await auditService.log({
      userId: auditUserId,
      action: 'correct_balance',
      entityType: 'bank_account',
      entityId: accountId,
      details: {
        reason: 'Reset stale negative bank balance to zero',
        old_balance: currentBalance,
        new_balance: 0,
        source: 'maintenance_script',
      },
      ipAddress: 'system',
      db_instance: trx,
    });
  });

  console.log(`Bank account ${accountId} balance reset from ${currentBalance.toFixed(2)} to 0.00 and audited.`);
  return { changed: true, accountId, oldBalance: currentBalance, newBalance: 0 };
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('resetNegativeBankBalance failed:', err);
      process.exit(1);
    });
}

module.exports = run;
