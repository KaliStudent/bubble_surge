import { createHash, randomUUID } from 'node:crypto'
import { PACKS, STYLES } from '../server/catalog.mjs'

/** D1 batch + SQL triggers keep money changes atomic across Worker instances. */
export class D1Store {
  constructor(db) { this.db = db }
  sql(query, ...args) { return this.db.prepare(query).bind(...args) }
  async wallet(user) {
    const result = await this.db.batch([
      this.sql('INSERT OR IGNORE INTO wallets(user_id) VALUES (?)', user),
      this.sql('SELECT prisms,equipped FROM wallets WHERE user_id=?', user),
      this.sql('SELECT style FROM owned WHERE user_id=? ORDER BY style', user),
    ])
    return { ...result[1].results[0], owned: result[2].results.map(row => row.style) }
  }
  async invoice(user, packId) {
    const pack = PACKS.find(item => item.id === packId)
    if (!pack) throw new Error('Unknown pack')
    const id = randomUUID()
    await this.db.batch([
      this.sql('INSERT OR IGNORE INTO wallets(user_id) VALUES (?)', user),
      this.sql('INSERT INTO invoices(id,user_id,pack,stars,prisms,created) VALUES (?,?,?,?,?,?)', id, user, pack.id, pack.stars, pack.prisms, Date.now()),
    ])
    return { ...pack, id }
  }
  async validatePayment(user, payment, checkExpiry = false) {
    if (typeof payment.invoice_payload !== 'string') throw new Error('Invalid payment')
    const order = await this.sql('SELECT * FROM invoices WHERE id=?', payment.invoice_payload).first()
    if (!order || order.user_id !== user || payment.currency !== 'XTR' || payment.total_amount !== order.stars) throw new Error('Invalid payment')
    if (checkExpiry && (order.state !== 'pending' || Date.now() - order.created > 900000)) throw new Error('Expired invoice')
    return order
  }
  async credit(user, payment) {
    const order = await this.validatePayment(user, payment)
    const charge = payment.telegram_payment_charge_id
    if (typeof charge !== 'string' || !charge.length || charge.length > 512) throw new Error('Invalid charge')
    // SELECT avoids re-running the BEFORE trigger for already-paid/refunded invoices.
    // A conflicting charge fails the unique constraint and rolls back all effects.
    await this.sql(`INSERT INTO payments(charge,invoice,user_id,prisms,stars,created)
      SELECT ?,id,user_id,prisms,stars,? FROM invoices WHERE id=? AND state='pending'`, charge, Date.now(), order.id).run()
    const existing = await this.sql('SELECT * FROM payments WHERE invoice=?', order.id).first()
    if (!existing || existing.charge !== charge || existing.user_id !== user) throw new Error('Conflicting payment')
    return this.wallet(user)
  }
  async unlock(user, id) {
    if (id === 'default') {
      await this.wallet(user)
      await this.sql('UPDATE wallets SET equipped=NULL WHERE user_id=?', user).run()
      return this.wallet(user)
    }
    const style = STYLES.find(item => item.id === id)
    if (!style) throw new Error('Unknown style')
    await this.db.batch([
      this.sql('INSERT OR IGNORE INTO wallets(user_id) VALUES (?)', user),
      this.sql('INSERT INTO owned(user_id,style,cost) VALUES (?,?,?) ON CONFLICT(user_id,style) DO NOTHING', user, id, style.price),
      this.sql('UPDATE wallets SET equipped=? WHERE user_id=?', id, user),
    ])
    return this.wallet(user)
  }
  async refund(charge) {
    const payment = await this.sql('SELECT * FROM payments WHERE charge=?', charge).first()
    if (!payment) throw new Error('Receipt not found')
    await this.sql('UPDATE payments SET refunded=1 WHERE charge=? AND refunded=0', charge).run()
    return this.wallet(payment.user_id)
  }
  async limited(key, max, window = 60000, now = Date.now()) {
    const bucket = Math.floor(now / window)
    const hashed = createHash('sha256').update(key).digest('hex')
    const row = await this.sql(`INSERT INTO rate_limits(key,count,expires) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`, `${hashed}:${bucket}`, (bucket + 1) * window).first()
    return row.count > max
  }
  async cleanup() {
    await this.db.batch([
      this.sql('DELETE FROM events WHERE created < ?', Date.now() - 30 * 86400000),
      this.sql('DELETE FROM rate_limits WHERE expires < ?', Date.now()),
    ])
  }
  async report() {
    const result = await this.db.batch([
      this.sql('SELECT event,COUNT(*) AS count,COUNT(DISTINCT player) AS players FROM events GROUP BY event'),
      this.sql('SELECT COUNT(*) AS purchases,COALESCE(SUM(stars),0) AS gross_stars,COUNT(DISTINCT user_id) AS payers FROM payments WHERE refunded=0'),
      this.sql(`WITH visits AS (SELECT DISTINCT player,date(created/1000,'unixepoch') AS day FROM events),
        cohorts AS (SELECT player,MIN(day) AS first_day FROM visits GROUP BY player)
        SELECT COUNT(*) AS players,SUM(EXISTS(SELECT 1 FROM visits v WHERE v.player=c.player AND v.day=date(c.first_day,'+1 day'))) AS returned_d1,
        SUM(EXISTS(SELECT 1 FROM visits v WHERE v.player=c.player AND v.day=date(c.first_day,'+7 day'))) AS returned_d7
        FROM cohorts c WHERE first_day <= date('now','-7 day')`),
    ])
    return { events: result[0].results, revenue: result[1].results[0], matureCohortRetention: result[2].results[0], caveat: 'Opt-in, client-reported events; gross Stars are not profit.' }
  }
}
