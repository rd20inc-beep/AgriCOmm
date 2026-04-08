/**
 * Standard pagination helper — reduces boilerplate in list endpoints.
 */

/**
 * Parse pagination params from request query.
 * @param {Object} query - req.query object
 * @param {number} defaultLimit - default page size
 * @returns {{ page: number, limit: number, offset: number }}
 */
function parsePagination(query, defaultLimit = 50) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.max(1, Math.min(200, parseInt(query.limit) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Build pagination response metadata.
 * @param {number} total - total record count
 * @param {number} page - current page
 * @param {number} limit - page size
 */
function paginationMeta(total, page, limit) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = { parsePagination, paginationMeta };
