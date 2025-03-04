/* eslint-disable max-len */
const Path = require('path');

const {
  slugify,
  compose,
  childrenToList,
  stripDirectoryPath,
} = require('./src/utils/utils');
const {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  pathCollisionDetector,
  buildFileTree,
  buildFileTreeNode,
  getChildSidebar,
  unorderify,
  getDocSection,
  buildBreadcrumbs,
  dedupePath,
  addTrailingSlash,
  removeEnPrefix,
  translatePath,
  getSlug,
  getTranslatedSlug,
} = require('./src/utils/utils.node');

/* constants */
// auxilary flag to determine the environment (staging/prod)
const isProduction =
  process.env.GATSBY_DEFAULT_DOC_URL === 'https://k6.io/docs';

// @TODO: remove this after the porting of cloud rest api
// section will be finished
const replaceRestApiRedirect = ({ isProduction, title, redirect }) => {
  if (!isProduction && title === 'Cloud REST API') {
    const docUrl = process.env.GATSBY_DEFAULT_DOC_URL;
    const domain = docUrl.includes('8000') ? `` : `/docs`;
    return `${domain}/cloud-rest-api/introduction`;
  }
  return redirect;
};

const getPageTranslations = (
  relativeDirectory,
  name,
  getGuidesSidebar,
  reporter,
) => {
  const treeReducer = (subtree, currentNode) => {
    if (
      !subtree ||
      typeof subtree.children === 'undefined' ||
      typeof subtree.children[currentNode] === 'undefined'
    ) {
      return null;
    }
    return subtree.children[currentNode];
  };

  const pageTranslations = {};

  const filePath = unorderify(
    stripDirectoryPath(relativeDirectory, 'guides'),
    // remove locale prefix
  ).slice(3);

  SUPPORTED_LOCALES.forEach((locale) => {
    let translation = [...filePath.split('/'), unorderify(name)].reduce(
      treeReducer,
      getGuidesSidebar(locale),
    );

    if (translation && translation.meta) {
      translation = translation.meta;
    } else {
      translation = null;
    }

    if (translation) {
      pageTranslations[locale] = translation;
    } else {
      reporter.warn(
        `No ${locale} translation found for ${relativeDirectory}/${name}`,
      );
    }
  });

  return pageTranslations;
};

const generateTopLevelLinks = (topLevelLinks) => [
  {
    label: 'guides',
    to: '/',
  },
  ...topLevelLinks.slice(0, 3),
  {
    label: 'ecosystem',
    to: '/ecosystem/',
  },
  ...topLevelLinks.slice(3, topLevelLinks.length),
];

function generateSidebar({ nodes, type = 'docs' }) {
  const sidebarTreeBuilder = buildFileTree(buildFileTreeNode);

  nodes.forEach(({ name, relativeDirectory, children: [remarkNode] }) => {
    const {
      frontmatter: { title, redirect, hideFromSidebar, draft, slug },
    } = remarkNode;

    // skip altogether if this content has draft flag
    // OR hideFromSidebar
    if (draft === 'true' && isProduction) return;

    // titles like k6/html treated like paths otherwise
    const translatedPath = `${stripDirectoryPath(
      relativeDirectory,
      type,
    )}/${title.replace(/\//g, '-')}`;

    const pageLocale =
      SUPPORTED_LOCALES.find((locale) =>
        translatedPath.startsWith(`${locale}/`),
      ) || DEFAULT_LOCALE;

    let pageSlug =
      pageLocale === DEFAULT_LOCALE
        ? `/${getSlug(translatedPath)}`
        : `/${getTranslatedSlug(
            relativeDirectory,
            title,
            pageLocale,
            'guides',
          )}`;

    if (pageSlug === '//') {
      pageSlug = '/';
    }

    sidebarTreeBuilder.addNode(
      unorderify(stripDirectoryPath(relativeDirectory, type)),
      unorderify(name),
      {
        path: slug || pageSlug,
        title,
        redirect: replaceRestApiRedirect({ isProduction, title, redirect }),
        hideFromSidebar: hideFromSidebar || false,
        isActiveSidebarLink: true,
      },
    );
  });

  return sidebarTreeBuilder.getTree();
}

function getSupplementaryPagesProps({
  reporter,
  topLevelNames,
  topLevelLinks,
  getSidebar,
  getGuidesSidebar,
}) {
  const notFoundProps = {
    path: '/404',
    component: Path.resolve(`./src/templates/404.js`),
    context: {
      sidebarTree: getSidebar('guides'),
      navLinks: generateTopLevelLinks(topLevelLinks),
    },
  };
  const stubPagesProps = topLevelNames
    .filter(
      (s) =>
        ![
          'javascript api',
          'examples',
          isProduction ? 'cloud rest api' : '',
        ].includes(s.toLowerCase()),
    )
    .flatMap((section) => {
      return childrenToList(getSidebar(section).children).map(({ name }) => {
        const path = `${section}/${name}`;
        const breadcrumbs = compose(buildBreadcrumbs, dedupePath)(path);
        return {
          path: compose(
            removeEnPrefix,
            addTrailingSlash,
            dedupePath,
            slugify,
          )(path),
          component: Path.resolve('./src/templates/docs/breadcrumb-stub.js'),
          context: {
            sidebarTree: getSidebar(section),
            breadcrumbs,
            title: name,
            navLinks: generateTopLevelLinks(topLevelLinks),
            directChildren: getSidebar(section).children[name].children,
          },
        };
      });
    });

  const stubGuidesPagesProps = SUPPORTED_LOCALES.flatMap((locale) => {
    return childrenToList(getGuidesSidebar(locale).children).map(
      ({ name, meta }) => {
        const path = `${locale}/${meta.title}`;
        const breadcrumbs = compose(
          buildBreadcrumbs,
          removeEnPrefix,
          dedupePath,
        )(path);

        const pageTranslations = {};
        SUPPORTED_LOCALES.forEach((locale) => {
          if (
            typeof getGuidesSidebar(locale).children[name] !== 'undefined' &&
            typeof getGuidesSidebar(locale).children[name].meta !== 'undefined'
          ) {
            pageTranslations[locale] = getGuidesSidebar(locale).children[
              name
            ].meta;
          } else {
            reporter.warn(`No ${locale} translation found for ${name}`);
          }
        });

        return {
          path: compose(
            removeEnPrefix,
            addTrailingSlash,
            dedupePath,
            slugify,
          )(path),
          component: Path.resolve('./src/templates/docs/breadcrumb-stub.js'),
          context: {
            sidebarTree: getGuidesSidebar(locale),
            breadcrumbs: breadcrumbs.filter(
              (item) =>
                !SUPPORTED_LOCALES.includes(item.path.replace(/\//g, '')),
            ),
            title: meta.title,
            navLinks: generateTopLevelLinks(topLevelLinks),
            directChildren: getGuidesSidebar(locale).children[name].children,
            locale,
            translations: pageTranslations,
          },
        };
      },
    );
  });

  return stubPagesProps.concat(notFoundProps, stubGuidesPagesProps);
}

function getTopLevelPagesProps({
  topLevelNames,
  topLevelLinks,
  getSidebar,
  getGuidesSidebar,
  pathCollisionDetectorInstance,
}) {
  // generating pages currently presented in templates/docs/ folder
  // for the exception of Cloud REST API
  return topLevelNames
    .map((name) => {
      const slug = slugify(name);
      // manually exclude from top navigation cloud rest api section
      if (slug === 'cloud-rest-api') {
        return false;
      }
      // path collision check
      if (
        !pathCollisionDetectorInstance
          .add({ path: slug, name: `${slug}.js` })
          .isUnique()
      ) {
        // skip page creation if there is already a page with identical url
        return false;
      }

      return {
        path: slug === 'guides' ? `/` : `/${slug}/`,
        component: Path.resolve(`./src/templates/docs/${slug}.js`),
        context: {
          sidebarTree: getSidebar(name),
          navLinks: generateTopLevelLinks(topLevelLinks),
        },
      };
    })
    .concat(
      SUPPORTED_LOCALES.map((locale) => ({
        path: locale === 'en' ? '/' : `/${locale}/`,
        component: Path.resolve(`./src/templates/docs/guides.js`),
        context: {
          sidebarTree: getGuidesSidebar(locale),
          navLinks: generateTopLevelLinks(topLevelLinks),
          locale,
        },
      })),
    )
    .concat([
      {
        path: `/ecosystem/`,
        component: Path.resolve(`./src/templates/docs/ecosystem.js`),
        context: {
          sidebarTree: {
            children: {},
          },
          navLinks: generateTopLevelLinks(topLevelLinks),
        },
      },
      {
        path: `/ecosystem/bundle-builder/`,
        component: Path.resolve(`./src/templates/docs/bundle-builder.js`),
        context: {
          sidebarTree: {
            children: {},
          },
          navLinks: generateTopLevelLinks(topLevelLinks),
        },
      },
    ])
    .filter(Boolean);
}

function getDocPagesProps({
  nodes,
  reporter,
  topLevelLinks,
  getSidebar,
  pathCollisionDetectorInstance,
}) {
  // creating actual docs pages
  return nodes
    .map(({ relativeDirectory, children: [remarkNode], name }) => {
      // for debuggin purpose in case there are errors in md/html syntax
      if (typeof remarkNode === 'undefined') {
        reporter.warn(
          `\nMarkup of a page is broken, unable to generate. Check the following file: \n\n 
            ${relativeDirectory}/${name}`,
        );
        return false;
      }
      if (typeof remarkNode.frontmatter === 'undefined') {
        reporter.warn(
          `\nFrontmatter data is missing, unable to generate the page. Check the following file:\n\n ${relativeDirectory}/${name}`,
        );
        return false;
      }
      const {
        frontmatter,
        frontmatter: { title, redirect, draft, slug: customSlug },
      } = remarkNode;
      // if there is a value in redirect field, skip page creation
      // OR there is draft flag and mode is prod
      if ((draft === 'true' && isProduction) || redirect) {
        return false;
      }

      const strippedDirectory = stripDirectoryPath(relativeDirectory, 'docs');
      const path = `${strippedDirectory}/${title.replace(/\//g, '-')}`;

      const slug = customSlug ? addTrailingSlash(customSlug) : getSlug(path);
      // path collision check
      if (!pathCollisionDetectorInstance.add({ path: slug, name }).isUnique()) {
        // skip the page creation if there is already a page with identical url
        return false;
      }

      // generate breadcrumbs
      const breadcrumbs = compose(
        buildBreadcrumbs,
        dedupePath,
        unorderify,
      )(path);

      const extendedRemarkNode = {
        ...remarkNode,
        frontmatter: {
          ...frontmatter,
          slug,
          // injection of a link to an article in git repo
          fileOrigin: encodeURI(
            `https://github.com/k6io/docs/blob/master/src/data/${relativeDirectory}/${name}.md`,
          ),
        },
      };

      const docSection = compose(getDocSection, unorderify)(strippedDirectory);

      const sidebarTree = getSidebar(docSection);

      return {
        path: slug,
        component: Path.resolve('./src/templates/doc-page.js'),
        context: {
          remarkNode: extendedRemarkNode,
          sidebarTree,
          breadcrumbs,
          navLinks: generateTopLevelLinks(topLevelLinks),
        },
      };
    })
    .filter(Boolean);
}

function getGuidesPagesProps({
  nodesGuides,
  reporter,
  topLevelLinks,
  pathCollisionDetectorInstance,
  getGuidesSidebar,
}) {
  // creating actual docs pages
  return nodesGuides
    .map(({ relativeDirectory, children: [remarkNode], name }) => {
      const strippedDirectory = relativeDirectory.replace(
        /^.*guides\/(.*)$/,
        '$1',
      );
      // for debuggin purpose in case there are errors in md/html syntax
      if (typeof remarkNode === 'undefined') {
        reporter.warn(
          `\nMarkup of a page is broken, unable to generate. Check the following file: \n\n 
            ${relativeDirectory}/${name}`,
        );
        return false;
      }
      if (typeof remarkNode.frontmatter === 'undefined') {
        reporter.warn(
          `\nFrontmatter data is missing, unable to generate the page. Check the following file:\n\n ${relativeDirectory}/${name}`,
        );
        return false;
      }
      const {
        frontmatter,
        frontmatter: { title, redirect, draft, slug: customSlug },
      } = remarkNode;
      // if there is a value in redirect field, skip page creation
      // OR there is draft flag and mode is prod
      if ((draft === 'true' && isProduction) || redirect) {
        return false;
      }
      const path = `${strippedDirectory}/${title.replace(/\//g, '-')}`;

      const pageLocale =
        SUPPORTED_LOCALES.find((locale) =>
          strippedDirectory.startsWith(`${locale}/`),
        ) || DEFAULT_LOCALE;

      const slug =
        pageLocale === DEFAULT_LOCALE
          ? getSlug(path)
          : getTranslatedSlug(relativeDirectory, title, pageLocale, 'guides');

      const pageSlug = customSlug ? addTrailingSlash(customSlug) : slug;

      // path collision check
      if (!pathCollisionDetectorInstance.add({ path: slug, name }).isUnique()) {
        // skip the page creation if there is already a page with identical url
        return false;
      }

      // generate breadcrumbs
      let breadcrumbs = compose(
        buildBreadcrumbs,
        removeEnPrefix,
        dedupePath,
        unorderify,
      )(path);

      if (pageLocale !== DEFAULT_LOCALE) {
        const translatedPath = translatePath(unorderify(path), pageLocale);

        breadcrumbs = compose(
          buildBreadcrumbs,
          removeEnPrefix,
          dedupePath,
        )(translatedPath);
      }

      const sidebarTree = getGuidesSidebar(pageLocale);

      const pageTranslations = getPageTranslations(
        relativeDirectory,
        name,
        getGuidesSidebar,
        reporter,
      );

      const extendedRemarkNode = {
        ...remarkNode,
        frontmatter: {
          ...frontmatter,
          slug,
          // injection of a link to an article in git repo
          fileOrigin: encodeURI(
            `https://github.com/k6io/docs/blob/master/src/data/${relativeDirectory}/${name}.md`,
          ),
          translations: pageTranslations,
        },
      };

      return {
        path: pageSlug || '/',
        component: Path.resolve('./src/templates/doc-page.js'),
        context: {
          remarkNode: extendedRemarkNode,
          sidebarTree,
          breadcrumbs: breadcrumbs.filter(
            (item) => !SUPPORTED_LOCALES.includes(item.path.replace(/\//g, '')),
          ),
          navLinks: generateTopLevelLinks(topLevelLinks),
          locale: pageLocale,
        },
      };
    })
    .filter(Boolean);
}

async function fetchDocPagesData(graphql) {
  const {
    data: {
      allFile: { nodes },
    },
  } = await graphql(
    `
      query docPagesQuery {
        allFile(
          filter: {
            ext: { in: [".md"] }
            relativeDirectory: { regex: "/docs/" }
          }
          sort: { fields: absolutePath, order: ASC }
        ) {
          nodes {
            name
            relativeDirectory
            children {
              ... on Mdx {
                body
                frontmatter {
                  title
                  slug
                  head_title
                  excerpt
                  redirect
                  hideFromSidebar
                  draft
                }
              }
            }
          }
        }
      }
    `,
  );
  return nodes;
}

async function fetchGuidesPagesData(graphql) {
  const {
    data: {
      allFile: { nodes },
    },
  } = await graphql(
    `
      query guidesPagesQuery {
        allFile(
          filter: {
            ext: { in: [".md"] }
            relativeDirectory: { regex: "/translated-guides/" }
          }
          sort: { fields: absolutePath, order: ASC }
        ) {
          nodes {
            name
            relativeDirectory
            children {
              ... on Mdx {
                body
                frontmatter {
                  title
                  slug
                  head_title
                  excerpt
                  redirect
                  hideFromSidebar
                  draft
                }
              }
            }
          }
        }
      }
    `,
  );
  return nodes;
}

async function createDocPages({
  nodes,
  nodesGuides,
  sidebar,
  guidesSidebar,
  actions,
  reporter,
}) {
  // initiating path collision checker
  const pathCollisionDetectorInstance = pathCollisionDetector(reporter.warn);

  // local helper function that uses currying, expects one more arg
  const getSidebar = getChildSidebar(sidebar);

  // local helper function that uses currying, expects one more arg
  const getGuidesSidebar = getChildSidebar(guidesSidebar);

  // create data for rendering docs navigation
  const topLevelNames = Object.keys(sidebar.children);

  const topLevelLinks = topLevelNames
    .filter((name) => name !== 'Cloud REST API')
    .map((name) => ({
      label: name === 'cloud' ? 'Cloud Docs' : name.toUpperCase(),
      to: name === 'guides' ? `/` : `/${slugify(name)}/`,
    }));

  getDocPagesProps({
    nodes,
    reporter,
    topLevelLinks,
    pathCollisionDetectorInstance,
    getSidebar,
  })
    .concat(
      getGuidesPagesProps({
        nodesGuides,
        reporter,
        topLevelLinks,
        pathCollisionDetectorInstance,
        getGuidesSidebar,
      }),
      getTopLevelPagesProps({
        topLevelNames,
        topLevelLinks,
        getSidebar,
        getGuidesSidebar,
        pathCollisionDetectorInstance,
      }),
      getSupplementaryPagesProps({
        topLevelNames,
        topLevelLinks,
        getSidebar,
        getGuidesSidebar,
        reporter,
      }),
    )
    .map((pageProps) => actions.createPage(pageProps));
}

const createRedirects = ({ actions }) => {
  const { createRedirect } = actions;

  createRedirect({
    fromPath: '/getting-started/welcome/',
    toPath: '/',
    redirectInBrowser: true,
    isPermanent: true,
  });
  createRedirect({
    fromPath: '/es/empezando/bienvenido/',
    toPath: '/es/',
    redirectInBrowser: true,
    isPermanent: true,
  });
  createRedirect({
    fromPath: '/cloud/analyzing-results/logs-tab/',
    toPath: '/cloud/analyzing-results/logs/',
    isPermanent: true,
  });
  createRedirect({
    fromPath: '/cloud/cloud-faq/calculating-virtual-uses-with-google-analytics',
    toPath: 'https://k6.io/blog/monthly-visits-concurrent-users',
    isPermanent: true,
  });

  const redirects = {
    '/javascript-api/k6-http/cookiejar-k6-http':
      '/javascript-api/k6-http/cookiejar/',
    '/javascript-api/k6-http/cookiejar-k6-http/cookiejar-cookiesforurl-url':
      '/javascript-api/k6-http/cookiejar/cookiejar-cookiesforurl-url/',
    '/javascript-api/k6-http/cookiejar-k6-http/cookiejar-set-name-value-options':
      '/javascript-api/k6-http/cookiejar/cookiejar-set-url-name-value-options/',
    '/javascript-api/k6-http/cookiejar/cookiejar-set-name-value-options':
      '/javascript-api/k6-http/cookiejar/cookiejar-set-url-name-value-options/',
    '/javascript-api/k6-http/filedata-k6-http':
      '/javascript-api/k6-http/filedata/',
    '/javascript-api/k6-http/params-k6-http': '/javascript-api/k6-http/params/',
    '/javascript-api/k6-http/response-k6-http':
      '/javascript-api/k6-http/response/',
    '/javascript-api/k6-http/response-k6-http/response-clicklink-params':
      '/javascript-api/k6-http/response/response-clicklink-params/',
    '/javascript-api/k6-http/response-k6-http/response-html':
      '/javascript-api/k6-http/response/response-html/',
    '/javascript-api/k6-http/response-k6-http/response-json-selector':
      '/javascript-api/k6-http/response/response-json-selector/',
    '/javascript-api/k6-http/response-k6-http/response-submitform-params':
      '/javascript-api/k6-http/response/response-submitform-params/',
    '/javascript-api/k6-metrics/counter-k6-metrics':
      '/javascript-api/k6-metrics/counter/',
    '/javascript-api/k6-metrics/gauge-k6-metrics':
      '/javascript-api/k6-metrics/gauge/',
    '/javascript-api/k6-metrics/rate-k6-metrics':
      '/javascript-api/k6-metrics/rate/',
    '/javascript-api/k6-metrics/trend-k6-metrics':
      '/javascript-api/k6-metrics/trend/',
    '/using-k6/archives-for-bundling-sharing-a-test': '/misc/archive-command/',
    '/using-k6/ssl-tls': '/using-k6/protocols/ssl-tls/',
    '/using-k6/ssl-tls/online-certificate-status-protocol-ocsp':
      '/using-k6/protocols/ssl-tls/online-certificate-status-protocol-ocsp/',
    '/using-k6/ssl-tls/ssl-tls-client-certificates':
      '/using-k6/protocols/ssl-tls/ssl-tls-client-certificates/',
    '/using-k6/ssl-tls/ssl-tls-version-and-ciphers':
      '/using-k6/protocols/ssl-tls/ssl-tls-version-and-ciphers/',
    '/using-k6/multipart-requests-file-uploads': '/examples/data-uploads/',
    '/getting-started/results-output/apache-kafka':
      '/results-visualization/apache-kafka/',
    '/getting-started/results-output/cloud': '/results-visualization/cloud/',
    '/results-visualization/k6-cloud-test-results':
      '/results-visualization/cloud/',
    '/getting-started/results-output/datadog':
      '/results-visualization/datadog/',
    '/getting-started/results-output/influxdb':
      '/results-visualization/influxdb-+-grafana/',
    '/getting-started/results-output/json': '/results-visualization/json/',
    '/getting-started/results-output/statsd': '/results-visualization/statsd/',
    '/javascript-api/k6-metrics/counter-k6-metrics/counter-add-value-tags':
      '/javascript-api/k6-metrics/counter/counter-add-value-tags/',
    '/javascript-api/k6-metrics/gauge-k6-metrics/gauge-add-value-tags':
      '/javascript-api/k6-metrics/gauge/gauge-add-value-tags/',
    '/javascript-api/k6-metrics/rate-k6-metrics/rate-add-value-tags':
      '/javascript-api/k6-metrics/rate/rate-add-value-tags/',
    '/javascript-api/k6-metrics/trend-k6-metrics/trend-add-value-tags':
      '/javascript-api/k6-metrics/trend/trend-add-value-tags/',
    '/using-k6/cloud-execution':
      '/cloud/creating-and-running-a-test/cloud-tests-from-the-cli/',
    '/using-k6/html/working-with-html-forms': '/examples/html-forms/',
    '/using-k6/html': '/javascript-api/k6-html/',
    '/using-k6/session-recording-har-support':
      '/test-authoring/recording-a-session/',
    '/cloud/creating-and-running-a-test/test-builder':
      '/test-authoring/test-builder/',
    '/cloud/creating-and-running-a-test/in-app-script-editor':
      '/cloud/creating-and-running-a-test/script-editor/',
    '/cloud/creating-and-running-a-test/recording-a-test-script':
      '/test-authoring/recording-a-session/browser-recorder/',
    '/cloud/creating-and-running-a-test/converters': '/integrations/',
    '/cloud/integrations/ci': '/integrations/',
    '/cloud/cloud-faq/what-is-data-retention':
      '/cloud/billing-user-menu/data-retention/',
    '/cloud/cloud-faq/pricing-faq': '/cloud/cloud-faq/pricing-questions/',
    '/cloud/cloud-faq/what-ip-addresses-are-used-by-the-k6-cloud':
      '/cloud/cloud-faq/general-questions/',
    '/cloud/cloud-faq/what-is-the-best-way-to-debug-my-load-test-scripts':
      '/cloud/cloud-faq/general-questions/',
    '/cloud/cloud-faq/i-was-invited-to-an-organization-and-i-cannot-run-tests':
      '/cloud/cloud-faq/general-questions/',
    '/cloud/cloud-faq/how-to-open-your-firewall-to-k6-cloud-service-for-cloud-executed-tests':
      '/cloud/cloud-faq/general-questions/',
    '/cloud/cloud-faq/test-status-codes': '/cloud/cloud-faq/general-questions/',
    '/cloud/cloud-faq/what-are-vus-virtual-users':
      '/cloud/cloud-faq/general-questions/',
    '/cloud/cloud-faq/data-uploads-with-k6-cloud':
      '/cloud/cloud-faq/general-questions/',
    '/misc/usage-reports': '/misc/usage-collection/',
    '/using-k6/using-node-modules': '/using-k6/modules/',
  };

  // eslint-disable-next-line no-restricted-syntax
  for (const [key, value] of Object.entries(redirects)) {
    createRedirect({
      fromPath: `${key}`,
      toPath: `${value}`,
      isPermanent: true,
    });
    createRedirect({
      fromPath: `${key}/`,
      toPath: `${value}`,
      isPermanent: true,
    });
  }

  // all redirects docs.k6.io
  [
    '/selection-findselector/',
    '/selection-attrname/',
    '/selection-getindex/',
    '/selection-nextselector/',
    '/selection-nextallselector/',
    '/selection-prevallselector/',
    '/selection-parentselector/',
    '/selection-parentsselector/',
    '/selection-prevuntilselector/',
    '/selection-nextuntilselector/',
    '/selection-parentsuntilselector/',
    '/selection-childrenselector/',
    '/selection/',
  ].forEach((item) => {
    createRedirect({
      fromPath: `/javascript-api/k6-html/selection${item}`,
      toPath: '/javascript-api/k6-html/selection/',
      isPermanent: true,
    });
  });

  [
    '/md4-input-outputencoding/',
    '/md5-input-outputencoding/',
    '/sha1-input-outputencoding/',
    '/sha256-input-outputencoding/',
    '/sha384-input-outputencoding/',
    '/sha512-input-outputencoding/',
    '/sha512_224-input-outputencoding/',
    '/sha512_256-input-outputencoding/',
    '/ripemd160-input-outputencoding/',
  ].forEach((item) => {
    createRedirect({
      fromPath: `/javascript-api/6-crypto/hmac${item}`,
      toPath: '/javascript-api/k6-crypto/',
      isPermanent: true,
    });
  });
};

exports.createPages = async (options) => {
  const pagesData = await fetchDocPagesData(options.graphql);
  const guidesData = await fetchGuidesPagesData(options.graphql);

  const sidebar = generateSidebar({ nodes: pagesData });
  const guidesSidebar = generateSidebar({ nodes: guidesData, type: 'guides' });

  await createDocPages({
    ...options,
    nodes: pagesData,
    nodesGuides: guidesData,
    sidebar,
    guidesSidebar,
  });
  await createRedirects(options);
};

exports.onCreateNode = ({ node, actions }) => {
  const { createNodeField } = actions;
  // Adding default values for some fields and moving them under node.fields
  // because that how createNodeField works
  if (node.frontmatter) {
    createNodeField({
      node,
      name: 'redirect',
      value: node.frontmatter.redirect || '',
    });
    createNodeField({
      node,
      name: 'hideFromSidebar',
      value: node.frontmatter.hideFromSidebar || false,
    });
    createNodeField({
      node,
      name: 'draft',
      value: node.frontmatter.draft || 'false',
    });
    createNodeField({
      node,
      name: 'head_title',
      value: node.frontmatter.head_title || '',
    });
    createNodeField({
      node,
      name: 'slug',
      value: node.frontmatter.slug || '',
    });
  }
};
