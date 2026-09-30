/**
 * The vendored foliate-js tree (extension/vendor/foliate-js) is plain
 * JavaScript with no type declarations. Our facades in src/foliate/ give
 * the parts we use full types on our side of the boundary; the raw vendor
 * imports below that stay `any`.
 */
declare module "*.js";
