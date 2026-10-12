import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { storefrontData, publishedMedia } from "../../../../lib/catalog/storefront.ts";
import ProductDetail from "../../../../components/store/product-detail.tsx";
type Props={params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export async function generateMetadata({params}:Props):Promise<Metadata>{const {slug}=await params;const {catalog}=await storefrontData();const product=catalog.products.find((p)=>p.slug===slug);return product?{title:product.title,description:product.description.slice(0,160),alternates:{canonical:`/products/${product.slug}`}}:{title:"Product not found",robots:{index:false,follow:false}};}
export default async function ProductPage({params,searchParams}:Props){
  const [{slug},query,{catalog}]=await Promise.all([params,searchParams,storefrontData()]);const product=catalog.products.find((p)=>p.slug===slug);if(!product)notFound();
  const sizeGuide=catalog.sizeGuides.find((g)=>g.id===product.sizeGuideId);const category=catalog.categories.find((c)=>c.id===product.categoryId);const variant=typeof query.variant==='string'&&product.variants.some((v)=>v.id===query.variant)?query.variant:undefined;
  const videos=await publishedMedia(product.media.filter((media)=>media.type==="video").map((media)=>media.id));
  const videoPosters=Object.fromEntries(videos.flatMap((media)=>media.posterKey?[[media.id,media.posterKey]]:[]));
  const relatedProducts=catalog.products.filter((p)=>p.id!==product.id&&p.categoryId===product.categoryId).slice(0,4);
  return <ProductDetail key={`${product.id}:${variant??""}`} product={product} {...(sizeGuide?{sizeGuide}:{})} {...(variant?{initialVariantId:variant}:{})} {...(category?{category:{name:category.name,href:catalog.collections.some((c)=>c.slug===category.slug)?`/collections/${category.slug}`:"/collections/all"}}:{})} relatedProducts={relatedProducts} sizeGuides={catalog.sizeGuides} videoPosters={videoPosters}/>;
}
