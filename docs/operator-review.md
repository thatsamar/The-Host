# Operator review checklist

Every draft The Host produces in the MVP is reviewed by a human before it is
sent. The prototype (`host-cli --review`) walks the operator through this list
and logs the verdict and any correction to `data/log/`. Every correction becomes
training data.

1. Does the plan make sense?
2. Is the geography sane? (No cross-town zig-zags.)
3. Is the venue actually open tonight?
4. Is it bookable, or is there a real walk-in path?
5. Does the answer match this user's taste and this occasion?
6. Is the recommendation too obvious?
7. Is it too obscure?
8. Is the night paced well?
9. Would we actually send someone we like there?

Voice check (automated, see `host/voice.py`): no dead language, no lists longer
than the format allows.
