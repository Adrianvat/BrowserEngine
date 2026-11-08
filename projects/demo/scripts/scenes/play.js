import { Body, Canvas, Circle, Collider, Rect, Transform, Velocity } from "engine";

/**
 * How many times the play scene has started. A module lives as long as the game page,
 * so this survives scene switches; the title scene shows it.
 */
export const plays = { count: 0 };

/**
 * The hero walking around among toys (boxes and balls) that fall, bounce and can be
 * kicked up, all kept in by the walls. The hero's Body has no gravity, so it walks
 * freely; its layer only touches the toys' layer, and a touched toy pops. The hero,
 * the walls and the hint come from play.json; the systems (input, kick, physics,
 * popping, appearance, Escape) are the scripts listed for this scene.
 */
export default function setup(scene) {
  const { world } = scene;
  const { width, height } = world.getResource(Canvas);
  plays.count++;

  // Random every time, so these are made here rather than in play.json. They start in
  // the top half, clear of the floor; every other one is a ball.
  for (let i = 0; i < 10; i++) {
    const size = 12 + Math.random() * 24;
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 160;
    const color = `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`;
    const ball = i % 2 === 1;
    const e = world.spawn();
    world.add(e, new Transform(Math.random() * (width - size), Math.random() * (height / 2)));
    world.add(e, ball ? new Circle(size / 2, color) : new Rect(size, size, color));
    world.add(
      e,
      new Collider(size, size, {
        shape: ball ? "circle" : "box",
        layer: "toy",
        restitution: 0.5,
        friction: 0.4,
      }),
    );
    world.add(e, new Velocity(Math.cos(angle) * speed, Math.sin(angle) * speed));
    // Heavier the bigger it is, so a kick sends small rects higher than large ones.
    world.add(e, new Body({ mass: size / 24 }));
  }
}
