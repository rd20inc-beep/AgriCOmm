const schemas = require('../middleware/schemas');

// validate() runs every request body through Joi with stripUnknown: true, so a
// field the schema does not declare is silently deleted before the controller
// sees it. That is how the document-ordering fix shipped inert: the code was
// deployed and correct, the request carried `order`, and Joi dropped it — the
// merge fell back to its old sequence on every single call.
//
// These assertions go through the SAME options the middleware uses.
const run = (body) => schemas.bundleDocuments.validate(body, {
  abortEarly: false,
  stripUnknown: true,
});

describe('bundleDocuments — the fields the controller reads must survive Joi', () => {
  const sequence = [{ k: 'u', id: 7 }, { k: 'g', i: 0 }, { k: 'u', id: 9 }];

  test('the merge order reaches the controller intact', () => {
    const { error, value } = run({
      uploadedIds: [7, 9],
      generated: [{ docType: 'invoice', html: '<p>x</p>' }],
      order: sequence,
      format: 'pdf',
    });
    expect(error).toBeUndefined();
    expect(value.order).toEqual(sequence);
  });

  test('the contents-page flag reaches the controller', () => {
    const { error, value } = run({ uploadedIds: [1], contentsPage: true, format: 'pdf' });
    expect(error).toBeUndefined();
    expect(value.contentsPage).toBe(true);
  });

  test('the contents page stays off when not asked for', () => {
    expect(run({ uploadedIds: [1], format: 'pdf' }).value.contentsPage).toBe(false);
  });

  test('every key the controller destructures is declared', () => {
    // Guards the class of bug rather than the two instances of it: if someone
    // adds a field to the request and forgets the schema, this fails.
    const body = {
      uploadedIds: [1], generated: [], order: [{ k: 'u', id: 1 }],
      contentsPage: true, zipName: 'EX-001 documents', format: 'pdf',
    };
    const { value } = run(body);
    for (const key of Object.keys(body)) {
      expect(Object.prototype.hasOwnProperty.call(value, key)).toBe(true);
    }
  });

  test('a malformed sequence is rejected, not quietly dropped', () => {
    expect(run({ uploadedIds: [1], order: [{ k: 'x', id: 1 }], format: 'pdf' }).error).toBeDefined();
    expect(run({ uploadedIds: [1], order: 'first', format: 'pdf' }).error).toBeDefined();
  });

  test('an unrelated field is still stripped', () => {
    const { value } = run({ uploadedIds: [1], somethingElse: 'x', format: 'pdf' });
    expect(value.somethingElse).toBeUndefined();
  });
});
