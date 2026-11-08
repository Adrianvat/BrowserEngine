/** The most recent values of one measurement, oldest first. Older values fall off the end. */
export class Series {
  private readonly values: Float64Array;
  /** Where the next value goes. */
  private next = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`Series capacity must be a positive integer, got ${capacity}`);
    }
    this.values = new Float64Array(capacity);
  }

  /** How many values are kept right now (at most `capacity`). */
  get length(): number {
    return this.count;
  }

  push(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** The value at `index`, where 0 is the oldest kept and `length - 1` the newest. */
  at(index: number): number {
    if (index < 0 || index >= this.count) {
      throw new RangeError(`Series index ${index} is out of range (length ${this.count})`);
    }
    return this.values[(this.next - this.count + index + this.capacity) % this.capacity];
  }

  /** The newest value, or 0 when empty. */
  get last(): number {
    return this.count === 0 ? 0 : this.at(this.count - 1);
  }

  /** The mean of the kept values, or 0 when empty. */
  get average(): number {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.at(i);
    return sum / this.count;
  }

  /** The largest kept value, or 0 when empty. */
  get max(): number {
    if (this.count === 0) return 0;
    let max = this.at(0);
    for (let i = 1; i < this.count; i++) max = Math.max(max, this.at(i));
    return max;
  }

  clear(): void {
    this.next = 0;
    this.count = 0;
  }
}
