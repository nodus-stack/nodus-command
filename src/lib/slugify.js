import slugifyLib from 'slugify';

export function slugify(text) {
  return slugifyLib(text, {
    lower: true,
    strict: true,
    locale: 'es',
    remove: /[*+~.()'"!:@]/g
  });
}

export function slugifyWithPreview(text) {
  const slug = slugify(text);
  return {
    original: text,
    slug: slug,
    domain: `${slug}.localhost`
  };
}