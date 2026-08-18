/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Markdown the server reads at runtime — brand memory, the skills library
    // and Mike Delight's character constitution. Next's tracer cannot always
    // follow a `path.join(process.cwd(), …)` read, and a missing constitution
    // would silently strip Mike's personality on a deployed build while every
    // factual check kept passing. Traced explicitly so that cannot happen.
    outputFileTracingIncludes: {
      '/api/**/*': ['./brand/**/*.md', './skills/**/*.md', './operator/**/*.md'],
    },
  },
};

export default nextConfig;
