// Wrapper-only component to avoid SSR hydration issues.
// Implements: dynamic import of the client-only inner component with ssr: false.
import dynamic from "next/dynamic";

const CityZipAutocomplete = dynamic(() => import("./CityZipAutocompleteInner"), { ssr: false });

export default CityZipAutocomplete;
