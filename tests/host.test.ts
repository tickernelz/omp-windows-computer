import { test } from "node:test";
import * as assert from "node:assert";
import { parseDrvfsMounts, buildPathTranslators } from "../lib/host.ts";

test("parseDrvfsMounts: extracts Windows drive mappings correctly", () => {
  const mounts = `
rootfs / rootfs rw 0 0
sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
drivers /usr/lib/wsl/drivers 9p ro,nosuid,nodev,noatime,aname=drivers 0 0
C:\\\\134 /mnt/c 9p rw,noatime,aname=drvfs;path=C:\\\\;uid=1000;gid=1000;symlinkroot=/mnt/ 0 0
D:\\\\134 /mnt/d 9p rw,noatime,aname=drvfs;path=D:\\\\;uid=1000 0 0
E:\\\\134 /custom/e 9p rw,noatime,aname=drvfs;path=E:\\\\;uid=1000 0 0
`;
  const mappings = parseDrvfsMounts(mounts);
  assert.strictEqual(mappings.length, 3);
  assert.strictEqual(mappings[0].drive, "C");
  assert.strictEqual(mappings[0].mountPoint, "/mnt/c");
  assert.strictEqual(mappings[1].drive, "D");
  assert.strictEqual(mappings[1].mountPoint, "/mnt/d");
  assert.strictEqual(mappings[2].drive, "E");
  assert.strictEqual(mappings[2].mountPoint, "/custom/e");
});

test("buildPathTranslators: handles standard and custom drive mounts", () => {
  const mappings = [
    { drive: "C", mountPoint: "/mnt/c" },
    { drive: "D", mountPoint: "/mnt/d" },
    { drive: "E", mountPoint: "/custom/e" }
  ];
  const { toWindowsPath, toHostPath } = buildPathTranslators(mappings);

  assert.strictEqual(toWindowsPath("/mnt/c/Users/Zhafron/file.txt"), "C:\\Users\\Zhafron\\file.txt");
  assert.strictEqual(toWindowsPath("/custom/e/Projects/repo"), "E:\\Projects\\repo");
  assert.strictEqual(toHostPath("C:\\\\Users\\\\Zhafron\\\\file.txt"), "/mnt/c/Users/Zhafron/file.txt");
  assert.strictEqual(toHostPath("E:\\\\Projects\\\\repo"), "/custom/e/Projects/repo");

  assert.throws(() => toWindowsPath("/var/log/syslog"), /DriveNotMounted/);
  assert.throws(() => toHostPath("Z:\\\\unmounted\\\\path"), /DriveNotMounted/);
});
