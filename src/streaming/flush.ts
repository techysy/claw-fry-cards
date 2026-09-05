/** 通用节流调度器 — FlushController（移植自 hermes-fry-cards streaming/flush.py）。 */

export type AsyncFn = () => Promise<void>;

export const CARDKIT_MS = 100; // CardKit 流式 API 的刷新间隔
export const LONG_GAP_MS = 2000; // 超过此间隔 → 认为是长时间空闲
export const BATCH_AFTER_GAP_MS = 300; // 长时间空闲后等待这个时间再 flush

/** 带互斥锁 + 延迟刷新的通用节流调度器。不包含飞书业务逻辑，只负责决定何时执行回调。 */
export class FlushController {
  private throttleMs: number;
  private flushInProgress = false;
  private needsReflush = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateTime = 0;
  private completed = false;
  private cardMessageReady = false;
  private flushWaiters: Array<() => void> = [];

  constructor(throttleMs: number = CARDKIT_MS) {
    this.throttleMs = throttleMs;
  }

  get last_update_time(): number {
    return this.lastUpdateTime;
  }

  /** 请求一次节流后的卡片刷新。do_flush: 执行实际 API 调用的 async 回调。 */
  scheduleUpdate(doFlush: AsyncFn): void {
    if (this.completed || !this.cardMessageReady) return;
    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;

    if (elapsed < this.throttleMs) {
      // 仍在节流窗口内 → 延迟到窗口边界
      if (this.pendingTimer === null) {
        this.schedule(this.throttleMs - elapsed, doFlush);
      }
      return;
    }

    if (elapsed > LONG_GAP_MS) {
      // 长时间空闲 → 延迟一小批让内容更完整；已有待触发 timer 则交给它
      if (this.pendingTimer === null) {
        this.schedule(BATCH_AFTER_GAP_MS, doFlush);
      }
      return;
    }

    // 立即 flush：先取消遗留的 pending timer，避免同一份数据被刷新两次
    this.cancelTimer();
    void this.doFlushTask(doFlush);
  }

  /** 立即执行一次 flush，等待完成。 */
  async flushNow(doFlush: AsyncFn): Promise<void> {
    if (this.completed || !this.cardMessageReady) return;
    this.cancelTimer();
    await this.doFlush(doFlush);
  }

  /** 等待进行中的 flush 完成。 */
  waitForFlush(): Promise<void> {
    if (!this.flushInProgress) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.flushWaiters.push(resolve);
    });
  }

  /** 标记完成，不再接受新更新。 */
  markCompleted(): void {
    this.completed = true;
    this.cancelTimer();
    for (const resolve of this.flushWaiters) resolve();
    this.flushWaiters = [];
  }

  setThrottle(ms: number): void {
    this.throttleMs = ms;
  }

  /** 设置卡片消息已就绪，初始化时间戳。 */
  setCardMessageReady(ready: boolean): void {
    this.cardMessageReady = ready;
    if (ready) this.lastUpdateTime = Date.now();
  }

  dispose(): void {
    this.markCompleted();
  }

  private schedule(delayMs: number, doFlush: AsyncFn): void {
    this.cancelTimer();
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.doFlushTask(doFlush);
    }, delayMs);
  }

  private async doFlushTask(doFlush: AsyncFn): Promise<void> {
    await this.doFlush(doFlush);
  }

  private async doFlush(doFlush: AsyncFn): Promise<void> {
    if (this.completed || this.flushInProgress) {
      this.needsReflush = true;
      return;
    }

    this.flushInProgress = true;
    this.needsReflush = false;
    // 在清零前快照完成态：若 markCompleted() 恰在此后、needsReflush=false 之前被调用，
    // 重刷请求不能丢失——它必须被「正确抑制」而不是被静默吞掉。
    const completedSnapshot = this.completed;
    try {
      await doFlush();
    } catch {
      // flush 错误抑制（业务层已记录日志）
    } finally {
      this.flushInProgress = false;
      this.lastUpdateTime = Date.now();
      const waiters = this.flushWaiters;
      this.flushWaiters = [];
      for (const resolve of waiters) resolve();
    }

    // flush 期间又有新数据 → 立即重刷；flush 期间完成了则不再重刷
    if (this.needsReflush && !this.completed && !completedSnapshot) {
      this.needsReflush = false;
      void this.doFlush(doFlush);
    }
  }

  private cancelTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
