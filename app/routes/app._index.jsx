import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("after") || null;
  const before = url.searchParams.get("before") || null;

  console.log(request);

  const response = await admin.graphql(
    `#graphql
    query getProducts($first: Int, $last: Int, $after: String, $before: String) {
      products(first: $first, last: $last, after: $after, before: $before) {
        edges {
          node {
            id
            title
            handle
            status
            featuredImage {
              url
              altText
            }
          }
          cursor
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }`,
    {
      variables: {
        first: !before ? 50 : null,
        last: before ? 50 : null,
        after,
        before,
      },
    },
  );

  const responseJson = await response.json();

  return {
    products: responseJson.data.products.edges,
    pageInfo: responseJson.data.products.pageInfo,
  };
};

export default function Index() {
  const { products, pageInfo } = useLoaderData();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const handleNextPage = () => {
    setSearchParams({ after: pageInfo.endCursor });
  };

  const handlePreviousPage = () => {
    setSearchParams({ before: pageInfo.startCursor });
  };

  return (
    <s-page heading="Products">
      <s-section>
        <s-table>
          <s-table-header-row>
            <s-table-header></s-table-header>
            <s-table-header list-slot="primary">Product</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {products.map(({ node: product }) => (
              <s-table-row key={product.id}>
                <s-table-cell>
                  {product.featuredImage ? (
                    <s-thumbnail
                      src={product.featuredImage.url}
                      alt={product.featuredImage.altText || product.title}
                      size="small"
                    />
                  ) : (
                    <s-thumbnail src="" alt={product.title} size="small" />
                  )}
                </s-table-cell>
                <s-table-cell>
                  <s-text type="strong">{product.title}</s-text>
                </s-table-cell>
                <s-table-cell>
                  <s-badge
                    tone={product.status === "ACTIVE" ? "success" : "info"}
                  >
                    {product.status}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-button
                    variant="secondary"
                    onClick={() =>
                      navigate(`/app/products/${product.id.split("/").pop()}`)
                    }
                  >
                    Customise
                  </s-button>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <s-box padding="block-start-400">
          <s-stack direction="inline" align-items="center">
            <s-pagination
              hasNext={pageInfo.hasNextPage}
              hasPrevious={pageInfo.hasPreviousPage}
              onNext={handleNextPage}
              onPrevious={handlePreviousPage}
            />
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
