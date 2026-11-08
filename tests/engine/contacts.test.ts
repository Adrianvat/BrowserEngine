import { describe, it, expect } from "vitest";
import { Contacts } from "../../src/engine/physics/contacts";

describe("Contacts", () => {
  it("starts empty", () => {
    const contacts = new Contacts();
    expect(contacts.all()).toEqual([]);
    expect(contacts.of(1)).toEqual([]);
    expect(contacts.between(1, 2)).toBe(false);
  });

  it("lists each touch once, and from either side with the normal turned around", () => {
    const contacts = new Contacts();
    contacts.add(1, 2, 0, 1);
    expect(contacts.all()).toEqual([{ entity: 1, other: 2, nx: 0, ny: 1 }]);
    expect(contacts.of(1)).toEqual([{ entity: 1, other: 2, nx: 0, ny: 1 }]);
    expect(contacts.of(2)).toEqual([{ entity: 2, other: 1, nx: 0, ny: -1 }]);
    expect(contacts.between(1, 2)).toBe(true);
    expect(contacts.between(2, 1)).toBe(true);
    expect(contacts.between(1, 3)).toBe(false);
  });

  it("keeps the first record of a pair, whichever way round it comes again", () => {
    const contacts = new Contacts();
    contacts.add(1, 2, 1, 0);
    contacts.add(2, 1, 0, 1);
    contacts.add(1, 2, 0, -1);
    expect(contacts.all()).toEqual([{ entity: 1, other: 2, nx: 1, ny: 0 }]);
    expect(contacts.of(2)).toHaveLength(1);
  });

  it("collects everything an entity touched", () => {
    const contacts = new Contacts();
    contacts.add(1, 2, 1, 0);
    contacts.add(3, 1, 0, -1);
    contacts.add(2, 3, 0, 1);
    expect(contacts.of(1).map((contact) => contact.other)).toEqual([2, 3]);
    expect(contacts.of(1)[1]).toEqual({ entity: 1, other: 3, nx: 0, ny: 1 });
    expect(contacts.all()).toHaveLength(3);
  });

  it("clear forgets everything", () => {
    const contacts = new Contacts();
    contacts.add(1, 2, 1, 0);
    contacts.clear();
    expect(contacts.all()).toEqual([]);
    expect(contacts.of(1)).toEqual([]);
  });
});
