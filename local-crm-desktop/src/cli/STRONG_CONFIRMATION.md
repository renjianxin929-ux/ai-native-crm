# Strong Confirmation (C6)

`customer.delete` first creates a pending proposal; it does not delete a customer.

A human must run `crm confirm --proposal <proposal_id> --phrase <nonce>`. An Agent must not press or execute that confirmation on the human's behalf.

For a `STRONG_CONFIRMATION_REQUIRED` envelope, `confirm_phrase_expected` is the existing proposal `nonce` in the pending record. The exact-confirmation gate validates that nonce, so the phrase is **not** the natural-language contract example `删除 广州星河科技`. There is no second name-based phrase protocol and no `AUTO_CONFIRM` path.
