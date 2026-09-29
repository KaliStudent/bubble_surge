import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { PACKS, STYLES } from './catalog.mjs'

export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS wallets (user_id TEXT PRIMARY KEY, prisms INTEGER NOT NULL DEFAULT 0 CHECK(prisms >= 0), equipped TEXT);
      CREATE TABLE IF NOT EXISTS owned (user_id TEXT NOT NULL REFERENCES wallets(user_id), style TEXT NOT NULL, cost INTEGER NOT NULL, PRIMARY KEY(user_id, style));
      CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES wallets(user_id), pack TEXT NOT NULL, stars INTEGER NOT NULL, prisms INTEGER NOT NULL, created INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS payments (charge TEXT PRIMARY KEY, invoice TEXT UNIQUE NOT NULL REFERENCES invoices(id), user_id TEXT NOT NULL, prisms INTEGER NOT NULL, stars INTEGER NOT NULL, refunded INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, player TEXT NOT NULL, session TEXT NOT NULL, event TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);`)
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  wallet(user) {
    this.db.prepare('INSERT OR IGNORE INTO wallets(user_id) VALUES (?)').run(user)
    const w = this.db.prepare('SELECT prisms, equipped FROM wallets WHERE user_id=?').get(user)
    return { ...w, owned: this.db.prepare('SELECT style FROM owned WHERE user_id=? ORDER BY style').all(user).map(s => s.style) }
  }
  invoice(user, packId) {
    const pack = PACKS.find(p => p.id === packId)
    if (!pack) throw new Error('Unknown pack')
    this.wallet(user)
    const id = randomUUID()
    this.db.prepare('INSERT INTO invoices(id,user_id,pack,stars,prisms,created) VALUES (?,?,?,?,?,?)')
      .run(id, user, pack.id, pack.stars, pack.prisms, Date.now())
    return { ...pack, id }
  }
  validatePayment(user, payment, checkExpiry = false) {
    const order = this.db.prepare('SELECT * FROM invoices WHERE id=?').get(payment?.invoice_payload ?? '')
    if (!order || order.user_id !== user || payment.currency !== 'XTR' || payment.total_amount !== order.stars) throw new Error('Payment does not match the invoice')
    if (checkExpiry && (order.state !== 'pending' || Date.now() - order.created > 15 * 60 * 1000)) throw new Error('Invoice expired. Please open a new purchase.')
    return order
  }
  credit(user, payment) {
    return this.transaction(() => {
      const order = this.validatePayment(user, payment)
      const charge = payment.telegram_payment_charge_id
      if (typeof charge !== 'string' || !charge || charge.length > 512) throw new Error('Missing payment receipt')
      const existing = this.db.prepare('SELECT * FROM payments WHERE charge=? OR invoice=?').get(charge, order.id)
      if (existing) {
        if (existing.charge !== charge || existing.invoice !== order.id) throw new Error('Conflicting payment receipt')
        return this.wallet(user)
      }
      if (order.state !== 'pending') throw new Error('Invoice already closed')
      this.db.prepare('INSERT INTO payments(charge,invoice,user_id,prisms,stars,created) VALUES (?,?,?,?,?,?)')
        .run(charge, order.id, user, order.prisms, order.stars, Date.now())
      this.db.prepare('UPDATE wallets SET prisms=prisms+? WHERE user_id=?').run(order.prisms, user)
      this.db.prepare("UPDATE invoices SET state='paid' WHERE id=?").run(order.id)
      return this.wallet(user)
    })
  }
  unlock(user, id) {
    if (id === 'default') {
      this.wallet(user)
      this.db.prepare('UPDATE wallets SET equipped=NULL WHERE user_id=?').run(user)
      return this.wallet(user)
    }
    const style = STYLES.find(s => s.id === id)
    if (!style) throw new Error('Unknown style')
    return this.transaction(() => {
      const wallet = this.wallet(user)
      if (!wallet.owned.includes(id)) {
        if (wallet.prisms < style.price) throw new Error('Not enough Prisms')
        this.db.prepare('UPDATE wallets SET prisms=prisms-? WHERE user_id=?').run(style.price, user)
        this.db.prepare('INSERT INTO owned(user_id,style,cost) VALUES (?,?,?)').run(user, id, style.price)
      }
      this.db.prepare('UPDATE wallets SET equipped=? WHERE user_id=?').run(id, user)
      return this.wallet(user)
    })
  }
  refund(charge) {
    return this.transaction(() => {
      const payment = this.db.prepare('SELECT * FROM payments WHERE charge=?').get(charge)
      if (!payment) throw new Error('Receipt not found')
      if (payment.refunded) return this.wallet(payment.user_id)
      // Reverse all style spends into Prisms before removing the refunded credit.
      // Other paid value is preserved; the player can re-equip with the remaining balance.
      const spent = this.db.prepare('SELECT COALESCE(SUM(cost),0) AS total FROM owned WHERE user_id=?').get(payment.user_id).total
      this.db.prepare('UPDATE wallets SET prisms=prisms+?-?, equipped=NULL WHERE user_id=?').run(spent, payment.prisms, payment.user_id)
      this.db.prepare('DELETE FROM owned WHERE user_id=?').run(payment.user_id)
      this.db.prepare('UPDATE payments SET refunded=1 WHERE charge=?').run(charge)
      this.db.prepare("UPDATE invoices SET state='refunded' WHERE id=?").run(payment.invoice)
      return this.wallet(payment.user_id)
    })
  }
  close() { this.db.close() }
}
