-- Copy this file to members_seed.sql and fill in real values before running.
--
-- id      : WhatsApp phone number, digits only, no + or spaces
--           e.g. +49 151 12345678 → 4915112345678
--           The bot matches the JID local part against this to identify "done" senders.
--
-- roomnumber : 1–5, two members per room (they are paired for weekly full clean)
--
-- gender  : 'm' or 'f' (determines toilet duty rotation)
--
-- NOTE: WhatsApp Business accounts still use phone-number JIDs — no special handling needed.

INSERT INTO members (id, name, roomnumber, gender) VALUES
  (4915100000001, 'Alice',   1, 'f'),
  (4915100000002, 'Bob',     1, 'm'),
  (4915100000003, 'Clara',   2, 'f'),
  (4915100000004, 'David',   2, 'm'),
  (4915100000005, 'Eva',     3, 'f'),
  (4915100000006, 'Felix',   3, 'm'),
  (4915100000007, 'Greta',   4, 'f'),
  (4915100000008, 'Hans',    4, 'm'),
  (4915100000009, 'Ida',     5, 'f'),
  (4915100000010, 'Jan',     5, 'm');
